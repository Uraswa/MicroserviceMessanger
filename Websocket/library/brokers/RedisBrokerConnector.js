import redis from "redis";
import ChatsModel from "../../../Model/ChatsModel.js";
import onlineCacheConnector from "../OnlineCacheConnector.js";

let redisPublisher = null;
let redisSubscriber = null;

class RedisBrokerConnector {
    async initSubscriber() {
        if (redisSubscriber != null) return;

        redisSubscriber = redis.createClient();

        await redisSubscriber.connect();
    }

    async initPublisher() {
        if (redisPublisher != null) return;

        redisPublisher = redis.createClient();
        await redisPublisher.connect();
    }

    async sendToExactMember(msg, receiverId) {

        let groupedParticipantsByWs = await onlineCacheConnector.groupUsersByActiveWebsockets(
            [receiverId]
        );

        for (let ws in groupedParticipantsByWs) {
            const redisMessage = JSON.stringify({
                ...msg,
                recipient_ids: groupedParticipantsByWs[ws],
                timestamp: new Date().toISOString()
            });

            await redisPublisher.publish(
                `ws` + ws,
                redisMessage
            );
        }
    }

    async sendToAllChatMembers(msg, chat_id, senderId, exemptSender = true, exactParticipants = undefined) {

        const participants = exactParticipants ? exactParticipants : await ChatsModel.getChatParticipants(chat_id);

        let groupedParticipantsByWs = await onlineCacheConnector.groupUsersByActiveWebsockets(
            participants,
            exemptSender ? senderId : undefined
        );

        for (let ws in groupedParticipantsByWs) {
            const redisMessage = JSON.stringify({
                ...msg,
                recipient_ids: groupedParticipantsByWs[ws],
                timestamp: new Date().toISOString()
            });

            await redisPublisher.publish(
                `ws` + ws,
                redisMessage
            );
        }
    }

    async brokerSubscribe(channel, callback) {
        await redisSubscriber.pSubscribe(channel, callback);
    }
}


let brokerConnector = new RedisBrokerConnector();
export default brokerConnector;