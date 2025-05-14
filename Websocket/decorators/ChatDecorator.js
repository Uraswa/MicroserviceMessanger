import WebsocketDecorator from "../library/WebsocketDecorator.js";
import InnerCommunicationService from "../../services/innerCommunicationService.js";

export class ChatDecorator extends WebsocketDecorator {

    async callback(ws, user_id, msg) {
        let chat_id = msg.data.chat_id;


        let chatResponse = await InnerCommunicationService.get('/api/getChatById?chat_id=' + chat_id, 8000);

        if (chatResponse.status !== 200 || !chatResponse.data.success) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Chat_not_exist"}));
        }

        let chat = chatResponse.data.data;

        if (!chat) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Chat_not_exist"}));
        } else {
            msg.chat = chat;
            await this.call(ws, user_id, msg)
        }
    }
}