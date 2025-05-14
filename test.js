import {Kafka, Partitioners, logLevel} from 'kafkajs';

const kafka = new Kafka({
    clientId: 'websocket-broker',
    brokers: [
        'localhost:9092',
        'localhost:9093',
        'localhost:9094'
    ]
});

let producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    transactionTimeout: 30000
});

try {
    await producer.connect();
    console.log("Connected")
} catch (error) {
    console.error('Failed to connect to Kafka:', error);

}

await producer.send({
                topic: `ws1`,
                messages: [{
                    value: '123123123',
                    key: "123"
                }],
                acks: 1
            });

const consumer = kafka.consumer({
            groupId: 'test', // No consumer group
            sessionTimeout: 30000,
            allowAutoTopicCreation: true
        });

 await consumer.connect();
        await consumer.subscribe({ topic: 'ws1', fromBeginning: true });

        await consumer.run({
            autoCommit: false, // Manual offset management
            eachMessage: async ({ message }) => {
                try {
                    const value = JSON.parse(message.value.toString());
                    console.log(value)
                } catch (error) {
                    console.error('Error processing message:', error);
                }
            }
        });

