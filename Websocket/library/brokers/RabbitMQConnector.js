import amqp from "amqplib";

class RabbitMQConnector {
    connection;

    constructor() {
        this.connection = null;
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

            console.log('RabbitMQ connection established');
        } catch (err) {
            console.error('Failed to connect to RabbitMQ:', err);
            throw err;
        }
    }
}

let newConnection = new RabbitMQConnector();
await newConnection.init();
export default newConnection;

