import ChatsModel from "../../Model/ChatsModel.js";
import WebsocketDecorator from "../library/WebsocketDecorator.js";

export class ChatDecorator extends WebsocketDecorator {

    async callback(ws, user_id, msg) {
        let chat_id = msg.data.chat_id;
        let chat = await ChatsModel.getChatById(chat_id);

        if (!chat) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Chat_not_exist"}));
        } else {
            msg.chat = chat;
            await this.call(ws, user_id, msg)
        }
    }
}