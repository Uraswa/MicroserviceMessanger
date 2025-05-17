import MessagesModel from "../Model/MessagesModel.js";
import InnerCommunicationService from "../services/innerCommunicationService.js";
import ApplicationCache from "../Websocket/library/ApplicationCache.js";

class MessagesSearcherController {

    async getMessages(req, res) {
        const user = req.user;

        try {
            const {chat_id, limit = 50, last_message_id = undefined} = req.query;
            if (!chat_id) {
                return res.status(400).json({
                    success: false,
                    error: 'chat_id is required'
                });
            }

            if (!user.is_server && !await ApplicationCache.getChatMember(chat_id, user.user_id)) {
                return res.status(403).json({
                    success: false,
                    error: 'Permission_denied'
                });
            }

            const messages = await MessagesModel.getMessages(chat_id, last_message_id)

            return res.status(200).json({
                success: true,
                data: messages
            });
        } catch (error) {
            console.log(error)
        }

        res.status(200).json({
            success: false,
            error: "Unknown_error"
        });
    }

    async getLastMessage(req, res) {
        const user = req.user;
        try {
            const {chat_id} = req.query;

            if (!user.is_server && !await ApplicationCache.getChatMember(chat_id, user.user_id)) {
                return res.status(403).json({
                    success: false,
                    error: 'access denied'
                });
            }

            let msg = await MessagesModel.getLastChatMessage(chat_id);
            if (!msg) {
                return res.status(200).json({
                    success: true,
                    data: {
                        msg: null
                    }
                });
            }

            let userProfiles = {};
            try {
                let result = await InnerCommunicationService.get(`/api/profiles/getUserProfilesByIds?ids=${JSON.stringify(Array.from([msg.user_id]))} `)
                userProfiles = result.data.data.profiles;
            } catch (e) {

            }

            return res.status(200).json({
                success: true,
                data: {
                    msg: msg,
                    profile: userProfiles ? userProfiles[0] : null
                }
            });
        } catch (e) {
            console.log(e);
        }

        res.status(200).json({
            success: false,
            error: "Unknown_error"
        });
    }

    async getLastMessageByChat(req, res) {
        let user = req.user;
        try {
            if (!user.is_server) {
                res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                });
            }

            let {chatsIds} = req.body;

            let messages = await MessagesModel.getLastMessagesByChat(chatsIds);

            return res.status(200).json({
                success: true,
                data: messages
            })
        } catch (e) {
            console.log(e);
        }

        res.status(200).json({
            success: false,
            error: "Unknown_error"
        });
    }


}

export default new MessagesSearcherController();