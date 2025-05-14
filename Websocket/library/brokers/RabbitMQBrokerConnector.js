import amqp from 'amqplib';
import onlineCacheConnector from "../OnlineCacheConnector.js";
import ApplicationCache from "../ApplicationCache.js";

class RabbitMQBrokerConnector {
    is_inited;

    constructor() {
        this.connection = null;
        this.channel = null;
        this.exchanges = new Set(); // Для отслеживания созданных exchange
    }

    async init() {
        if (this.connection) return;

        try {
            // Подключение к RabbitMQ с таймаутом
            this.connection = await amqp.connect('amqp://localhost', {
                heartbeat: 30,
                timeout: 10000
            });

            this.connection.on('error', (err) => {
                console.error('RabbitMQ connection error:', err);
                this.connection = null;
            });

            this.connection.on('close', () => {
                console.log('RabbitMQ connection closed');
                this.connection = null;
            });

            // Создание канала с подтверждениями
            this.channel = await this.connection.createConfirmChannel();
            await this.channel.prefetch(1); // Ограничиваем prefetch для надежности

            console.log('RabbitMQ connection established');
        } catch (err) {
            console.error('Failed to connect to RabbitMQ:', err);
            throw err;
        }
    }

    async initPublisher(){
        if (this.is_inited) return;
        await this.init();
    }

    async initSubscriber(){
        if (this.is_inited) return;
        await this.init();
    }

    async _ensureExchange(channelName) {
        const exchangeName = channelName;

        if (!this.exchanges.has(exchangeName)) {
            // Создаем durable direct exchange для этого вебсокета
            await this.channel.assertExchange(exchangeName, 'direct', {
                durable: true,
                autoDelete: false // Не удалять при отсутствии подписчиков
            });
            this.exchanges.add(exchangeName);
        }
    }

    async sendToExactMember(msg, receiverId) {
        await this.init();

        const groupedParticipantsByWs = await onlineCacheConnector.groupUsersByActiveWebsockets(
            [receiverId]
        );

        for (const ws in groupedParticipantsByWs) {
            await this._ensureExchange(ws);

            const message = JSON.stringify({
                ...msg,
                recipient_ids: Array.from(groupedParticipantsByWs[ws]),
                timestamp: new Date().toISOString()
            });

            try {
                // Отправка с подтверждением и persistent флагом
                await new Promise((resolve, reject) => {
                    this.channel.publish(
                        `ws${ws}`,
                        '', // routing key не используется для direct-to-queue
                        Buffer.from(message),
                        { persistent: true },
                        (err) => err ? reject(err) : resolve()
                    );
                });
            } catch (err) {
                console.error(`Failed to publish to ws${ws}:`, err);
                throw err;
            }
        }
    }

    async _getChatParticipants(chat_id) {
        const members = await ApplicationCache.getChatMembers(chat_id, true);
        return members?.map(v => v['user_id']) || [];
    }

    async sendToAllChatMembers(msg, chat_id, senderId, exemptSender = true, exactParticipants = undefined) {
        await this.init();

        const participants = exactParticipants || await this._getChatParticipants(chat_id);
        const groupedParticipantsByWs = await onlineCacheConnector.groupUsersByActiveWebsockets(
            participants,
            exemptSender ? senderId : undefined
        );

        for (const ws in groupedParticipantsByWs) {

            let channelName = 'ws' + ws;

            await this._ensureExchange(channelName);

            const message = JSON.stringify({
                ...msg,
                recipient_ids: Array.from(groupedParticipantsByWs[ws]),
                timestamp: new Date().toISOString()
            });

            try {
                await new Promise((resolve, reject) => {
                    this.channel.publish(
                        channelName,
                        '',
                        Buffer.from(message),
                        { persistent: true },
                        (err) => err ? reject(err) : resolve()
                    );
                });
            } catch (err) {
                console.error(`Failed to publish to ${channelName}:`, err);
                throw err;
            }
        }
    }

    async brokerSubscribe(channel, callback) {
        await this.init();
        await this._ensureExchange(channel);

        const exchangeName = channel;

        // Создаем durable очередь с уникальным именем
        const { queue } = await this.channel.assertQueue('', {
            exclusive: true, // Автоматически удаляется при отключении
            durable: false
        });

        // Привязываем очередь к exchange
        await this.channel.bindQueue(queue, exchangeName, '');

        console.log(`Subscribed to ${exchangeName} with queue ${queue}`);

        // Подписываемся с manual acknowledgment
        this.channel.consume(queue, async (msg) => {
            if (msg !== null) {
                try {

                    await callback(msg.content.toString(), channel);

                    // Подтверждаем обработку
                    this.channel.ack(msg);
                } catch (err) {
                    console.error('Message processing failed:', err);

                    // Возвращаем сообщение в очередь
                    this.channel.nack(msg, false, true);
                }
            }
        }, { noAck: false });

        return queue;
    }

    async close() {
        if (this.channel) {
            await this.channel.close();
            this.channel = null;
        }
        if (this.connection) {
            await this.connection.close();
            this.connection = null;
        }
    }
}

// Singleton экземпляр
const brokerConnector = new RabbitMQBrokerConnector();
export default brokerConnector;