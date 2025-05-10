import MessagesModel from "../../Model/MessagesModel.js";
import WebsocketDecorator from "../library/WebsocketDecorator.js";

export default class MessageAccessDecorator extends WebsocketDecorator {

    constructor(callback, isAdminActionAvailable) {
        super(callback);

        this.isAdminActionAvailable = isAdminActionAvailable;
    }

    async callback(ws, user_id, msg) {

        let message = await MessagesModel.getMessageById(msg.data.chat_id, msg.data.message_id);
        if (!message) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Message_not_exist"}));
            return;
        }

        if (message.user_id !== user_id && (!this.isAdminActionAvailable || this.isAdminActionAvailable && !msg.member.is_admin)) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Permission_denied"}));
            return;
        }

        msg.message = message;

        await this.call(ws, user_id, msg);
    }
}