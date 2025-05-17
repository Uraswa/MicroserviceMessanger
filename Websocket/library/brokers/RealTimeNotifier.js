import RabbitMQConnector from "./RabbitMQConnector.js";
import onlineCacheConnector from "../OnlineCacheConnector.js";

class RealTimeNotifier {

    constructor() {
         this.channel = null;
         this.exchanges = new Set(); // Для отслеживания созданных exchange
    }

    async init(){
        this.channel = await RabbitMQConnector.connection.createConfirmChannel();
        await this.channel.prefetch(1); // Ограничиваем prefetch для надежности
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

    async sendToExactUser(msg, receiverId) {
        const groupedUsersByWs = await onlineCacheConnector.groupUsersByActiveWebsockets(
            [receiverId]
        );

        for (const ws in groupedUsersByWs) {
            let channelName = `ws${ws}`
            await this._ensureExchange(channelName);

            const message = JSON.stringify({
                ...msg,
                recipient_ids: Array.from(groupedUsersByWs[ws]),
                timestamp: new Date().toISOString()
            });

            try {
                // Отправка с подтверждением и persistent флагом
                await new Promise((resolve, reject) => {
                    this.channel.publish(
                        channelName,
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

    async sendToUsers(msg, userIds, senderId, exemptSender = false) {

        const groupedUsersByWs = await onlineCacheConnector.groupUsersByActiveWebsockets(
            userIds,
            exemptSender ? senderId : undefined
        );

        for (const ws in groupedUsersByWs) {

            let channelName = 'ws' + ws;

            await this._ensureExchange(channelName);

            const message = JSON.stringify({
                ...msg,
                recipient_ids: Array.from(groupedUsersByWs[ws]),
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


}

const realTimeNotifier = new RealTimeNotifier();
await realTimeNotifier.init();
export default realTimeNotifier;