import MessagesModel from "../Model/MessagesModel.js";
import InnerCommunicationService from "../services/innerCommunicationService.js";
import ChatMembersNotifier from "../Websocket/library/brokers/ChatMembersNotifier.js";

class MessagesPublisherController {

    async createMessage(req, res) {
        let user = req.user;
        let user_id = user.user_id;
        try {

            let {chat_id, text} = req.body;

            let message = await MessagesModel.createMessage(chat_id, user_id, text);

            if (message && message.message_id) {

                let nickname = "Неизвестно";
                try {
                    let userProfileResp = await InnerCommunicationService.get(`/api/profiles/getUserProfilesByIds?ids=${JSON.stringify(Array.from([user_id]))}`, 8001)

                    if (userProfileResp.status === 200 && userProfileResp.data.data.profiles && userProfileResp.data.data.profiles.length !== 0) {
                        nickname = userProfileResp.data.data.profiles[0].nickname;
                    }
                } catch (e) {
                    console.log(e);
                }


                let brokerResponse = {
                    type: "sendMessage",
                    success: true,
                    data: {
                        chat_id: chat_id,
                        user_id: user_id,
                        text: text,
                        nickname: nickname,
                        message_id: message.message_id
                    }
                };

                await ChatMembersNotifier.sendToAllChatMembers(brokerResponse, chat_id, user_id, false);
                return res.status(200).json(brokerResponse);
            }
        } catch (e) {
            console.log(e);
        }
        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }


    async updateMessage(req, res) {
        let user = req.user;
        let user_id = user.user_id;
        try {
            let {chat_id, text} = req.body;
            let message = req.message;

            let response = {
                chat_id: chat_id,
                message_id: message.message_id,
                text: text
            };

            if (message.text === text) {
                return res.status(200).json({
                    type: "updateMessage",
                    success: true,
                    data: response
                })
            }

            let updateReq = await MessagesModel.updateMessage(chat_id, message.message_id, text);
            if (updateReq) {
                let brokerResponse = {
                    type: "updateMessage",
                    success: true,
                    data: response
                };
                await ChatMembersNotifier.sendToAllChatMembers(brokerResponse, chat_id, user_id, false);
                return res.status(200).json(brokerResponse);
            }
        } catch (e) {
            console.log(e);
        }
        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async deleteMessage(req, res) {
        let user = req.user;
        let user_id = user.user_id;
        try {
            let {chat_id, message_id} = req.body;
            let deleteMessageReq = await MessagesModel.deleteMessage(chat_id, message_id)
            if (deleteMessageReq) {
                let brokerResponse = {
                    type: "deleteMessage",
                    success: true,
                    data: {
                        chat_id: chat_id,
                        message_id: deleteMessageReq.message_id
                    }
                };

                await ChatMembersNotifier.sendToAllChatMembers(brokerResponse, chat_id, user_id, false);
                return res.status(200).json(brokerResponse);
            }
        } catch (e) {
            console.log(e);
        }
        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async clearMessages(req, res) {
        let user = req.user;
        let user_id = user.user_id;
        try {
            let {chat_id} = req.body;

            let chat = req.chat;
            let member = req.member;

            if (!chat.is_ls && !member.is_admin) {

                return res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                })
            }
            await MessagesModel.clearMessages(chat_id);
            let brokerResponse = {
                type: "clearChatHistory",
                success: true,
                data: {
                    chat_id: chat_id
                }
            };
            await ChatMembersNotifier.sendToAllChatMembers(brokerResponse, chat_id, user_id, false);
            return res.status(200).json(brokerResponse);
        } catch (e) {
            console.log(e);
        }
        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }


}

export default new MessagesPublisherController();