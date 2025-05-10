import WebsocketDecorator from "../library/WebsocketDecorator.js";

export class ChatTextDecorator extends WebsocketDecorator {
    async callback(ws, user_id, msg) {

        let text = msg.data.text;
        if (!text || text.length > 256) {
            ws.send(JSON.stringify({type: msg.type + "Resp", success: false, error: "Message_len"}));
            return;
        }

        await this.call(ws, user_id, msg);
    }
}