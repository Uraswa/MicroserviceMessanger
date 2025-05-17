import ApplicationCache from "../ApplicationCache.js";
import RealTimeNotifier from "./RealTimeNotifier.js";

class ChatMembersNotifier {


    async _getChatParticipants(chat_id) {
        const members = await ApplicationCache.getChatMembers(chat_id, true);
        return members?.map(v => v['user_id']) || [];
    }

    async sendToAllChatMembers(msg, chat_id, senderId, exemptSender = false, exactParticipants = undefined){
        const participants = exactParticipants || await this._getChatParticipants(chat_id);

        await RealTimeNotifier.sendToUsers(msg, participants, senderId, exemptSender);
    }

    async sendToExactMember(msg, receiverId) {
        await RealTimeNotifier.sendToExactUser(msg, receiverId);
    }


}

let chatMembersNotifier = new ChatMembersNotifier();
export default chatMembersNotifier;