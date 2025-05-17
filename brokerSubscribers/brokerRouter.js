import rabbitMQConnector from "../Websocket/library/brokers/RabbitMQConnector.js";
import DeleteChatSubsciber from "./DeleteChatSubsciber.js";


let channel = await rabbitMQConnector.connection.createChannel();
channel.assertQueue('chat.delete.event', {durable: false})

channel.consume('chat.delete.event', DeleteChatSubsciber, {
    noAck: true
});