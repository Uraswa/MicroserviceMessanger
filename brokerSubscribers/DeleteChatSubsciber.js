import MessagesModel from "../Model/MessagesModel.js";
import ChatToShardModel from "../Model/ChatToShardModel.js";

export default async (msg) => {
    msg = msg.content.toString();
    let {chat_id} = JSON.parse(msg);

    await Promise.all([
        MessagesModel.clearMessages(chat_id),
        ChatToShardModel.deleteChatShardInfo(chat_id)
    ]);
}