import * as model from './db.js'
import redis from "redis";

const redisPublisher = redis.createClient();
await redisPublisher.connect();


async function getChatParticipants(chat_id) {

    let members = await model.getChatParticipants(chat_id);
    return members.map(v => {
        return v['user_id']
    })
}

async function sendToExactMember(msg, receiverId) {

    const redisMessage = JSON.stringify({
        ...msg,
        recipient_id: receiverId,
        timestamp: new Date().toISOString()
    });

    await redisPublisher.publish(
        `user:${receiverId}`,
        redisMessage
    );
}

async function sendToAllChatMembers(msg, chat_id, senderId, exemptSender = true, exactParticipants = undefined) {

    const participants = exactParticipants ? exactParticipants : await getChatParticipants(chat_id);


    for (const participantId of participants) {
        if (participantId === senderId && !exemptSender || participantId !== senderId) {
            const redisMessage = JSON.stringify({
                ...msg,
                recipient_id: participantId,
                timestamp: new Date().toISOString()
            });

            await redisPublisher.publish(
                `user:${participantId}`,
                redisMessage
            );
        }
    }
}

export {
    sendToAllChatMembers,
    sendToExactMember,
    getChatParticipants
}