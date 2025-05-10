import ChatsModel from "../Model/ChatsModel.js";
import InnerCommunicationService from "../services/innerCommunicationService.js";
import RedisBrokerConnector from "../Websocket/library/brokers/RedisBrokerConnector.js";

const brokerConnector = RedisBrokerConnector;
await brokerConnector.initPublisher();

class ChatsController {

    async leaveChat(req, res) {
        try {
            const {chat_id} = req;
            const user_id = req.user.user_id;

            let chatParticipants = await ChatsModel.getChatParticipants(chat_id);
            let leaveChatResult = await ChatsModel.leaveChat(user_id, chat_id);
            if (leaveChatResult) {
                let response = {
                    type: "chatMemberLeaved",
                    success: true,
                    data: {
                        chat_id: chat_id,
                        user_id: user_id
                    }
                };
                await brokerConnector.sendToAllChatMembers(response, chat_id, user_id, false, chatParticipants);
                res.status(200).json(response);
            }
        } catch (e) {
            console.log(e);
        }

        res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async kickFromChat(req, res) {
        try {
            const {chat_id} = req;
            const self_userid = req.user.user_id;
            const other_user_id = req.body.user_id;

            let chatParticipants = await ChatsModel.getChatParticipants(chat_id);
            if (other_user_id === self_userid) {
                return res.status(200).json({
                    success: false,
                    error: "Self_kick_error"
                })
            }

            let kickResult = await ChatsModel.kickFromChat(other_user_id, chat_id);
            if (kickResult) {
                let response = {
                    type: "chatMemberLeaved",
                    success: true,
                    data: {
                        chat_id: chat_id,
                        user_id: other_user_id
                    }
                };
                await brokerConnector.sendToAllChatMembers(response, chat_id, self_userid, false, chatParticipants);
                return res.status(200).json(response);
            }
        } catch (e) {
            console.log(e)
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async createChat(req, res) {
        try {
            const user_id = req.user.user_id;

            let {chat_name, is_ls, other_user_id, text} = req.body;
            if (other_user_id) {

                let otherUserResponse = await InnerCommunicationService.get('/api/doesUserExist?user_id=' + other_user_id, 8002);
                if (otherUserResponse.status !== 200 || !otherUserResponse.data.success || !otherUserResponse.data.data.exist) {

                    return res.status(200).json({
                        success: false,
                        error: "User_not_exists"
                    })
                }

                if (await ChatsModel.getChatByOtherUserId(user_id, other_user_id)) {
                    return res.status(200).json({
                        success: false,
                        error: "Chat_already_exists"
                    })
                }

                let privateChatRes = await ChatsModel.createPrivateChat(user_id, other_user_id)
                if (privateChatRes) {

                    let userProfileResp = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from([user_id, other_user_id]))}`, 8001)

                    let nickname1 = "";
                    let nickname2 = "";

                    if (userProfileResp.status === 200 && userProfileResp.data.data.profiles.length === 2) {
                        let prof1 = userProfileResp.data.data.profiles[0];
                        let prof2 = userProfileResp.data.data.profiles[1];

                        if (prof1.user_id === user_id) nickname1 = prof1.nickname;
                        else if (prof1.user_id === other_user_id) nickname2 = prof1.nickname;


                        if (prof2.user_id === user_id) nickname1 = prof2.nickname;
                        else if (prof2.user_id === other_user_id) nickname2 = prof2.nickname;
                    }


                    let promise1 = brokerConnector.sendToExactMember({
                        type: "createChat",
                        success: true,
                        data: {
                            chat_id: privateChatRes.chat_id,
                            other_user_id: user_id,
                            sender_id: other_user_id,
                            is_ls: true,
                            chat_name: `Чат с ${nickname1}`
                        }
                    }, other_user_id);

                    let response = {
                        type: "createChat",
                        success: true,
                        data: {
                            chat_id: privateChatRes.chat_id,
                            other_user_id: other_user_id,
                            sender_id: user_id,
                            is_ls: true,
                            chat_name: `Чат с ${nickname2}`
                        }
                    };

                    let promise2 = brokerConnector.sendToExactMember(response, user_id);


                    await promise1;
                    await promise2;

                    //TODO!!!!
                    // await this.route(ws, user_id, {
                    //     type: "sendMessage",
                    //     data: {
                    //         chat_id: privateChatRes.chat_id,
                    //         text: text
                    //     }
                    // })

                    return res.status(200).json(response);

                }
            } else {
                if (!chat_name || chat_name.length > 40) {

                    return res.status(200).json({
                        success: false,
                        error: "Название чата не д.б. пустым или больше 40 символов!",
                        error_field: "chat_name"
                    })
                }

                let result = await ChatsModel.createGroupChat(user_id, chat_name);
                if (result) {
                    let response = {
                        type: "createChat",
                        success: true,
                        data: {
                            chat_id: result.chat_id,
                            chat_name: chat_name,
                            is_ls: false
                        }
                    }
                    await brokerConnector.sendToAllChatMembers(response, result.chat_id, user_id, false);
                    return res.status(200).json(response);
                }
            }
        } catch (e) {
            console.log(e);
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        });

    }


    async updateChat(req, res) {
        try {
            const user_id = req.user.user_id;

            let newchat_name = req.body.chat_name;
            let chat = req.chat;

            if (chat.is_ls) {

                return res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                })
            }

            if (!newchat_name || newchat_name.length > 40) {
                res.status(200).json({
                    success: false,
                    error_field: "chat_name",
                    error: "Название чата не д.б. пустым или больше 40 символов!"
                });
                return;
            }

            let result = await ChatsModel.updateGroupChat(chat.chat_id, newchat_name);
            if (result) {
                let response = {
                    type: "updateChat",
                    success: true,
                    data: {
                        chat_id: chat.chat_id,
                        chat_name: newchat_name
                    }
                }
                await brokerConnector.sendToAllChatMembers(response, chat.chat_id, user_id, false);
                return res.status(200).json(response);
            }
        } catch (e) {
            console.log(e);
        }


        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        });

    }

    async deleteChat(req, res) {

        try {
            let chat = req.chat;
            let user_id = req.user.user_id;
            let member = req.member;

            if (!chat.is_ls && !member.is_admin) {

                return res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                });
            }

            let chatParticipants = await ChatsModel.getChatParticipants(chat.chat_id);
            let result = await ChatsModel.deleteGroupChat(chat.chat_id, user_id);
            if (result) {
                let response = {
                    type: "deleteChat",
                    success: true,
                    data: {
                        chat_id: chat.chat_id
                    }
                };
                await brokerConnector.sendToAllChatMembers(response, chat.chat_id, user_id, false, chatParticipants)
                return res.status(200).json(response);
            }
        } catch (e) {
            console.log(e)
        }


        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        });
    }

    async blockUnblockUserInChat(req, res) {
        try {
            let chat = req.chat;
            let user_id = req.user.user_id;
            let member = req.member;
            let {other_user_id, block_state} = req.body;

            if (!chat.is_ls && !member.is_admin) {

                return res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                })
            }

            let otherMember = await ChatsModel.getChatMember(chat.chat_id, other_user_id);

            if (!otherMember) {
                return res.status(200).json({
                    success: false,
                    error: "User_not_found"
                })
            }

            if (otherMember.is_blocked && block_state || !otherMember.is_blocked && !block_state) {
                return res.status(200).json({
                    success: false,
                    error: "Already_blocked"
                })
            }

            let blockUnblockResult = await ChatsModel.blockUnblockUserInChat(chat.chat_id, other_user_id, block_state);
            if (!blockUnblockResult) {

                return res.status(200).json({
                    success: false,
                    error: "Unknown_error"
                })
            }

            let response = {
                type: "blockUnblockUserInChat",
                success: true,
                data: {
                    chat_id: msg.chat.chat_id,
                    other_user_id: other_user_id,
                    block_state: block_state
                }
            };

            await brokerConnector.sendToAllChatMembers(response, chat.chat_id, user_id, false);
            return res.status(200).json(response);
        } catch (e) {
            console.log(e);
        }
        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })

    }
}

export default new ChatsController();