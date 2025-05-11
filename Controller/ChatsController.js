import ChatsModel from "../Model/ChatsModel.js";
import InnerCommunicationService from "../services/innerCommunicationService.js";
import RedisBrokerConnector from "../Websocket/library/brokers/RedisBrokerConnector.js";

const brokerConnector = RedisBrokerConnector;
await brokerConnector.initPublisher();

class ChatsController {

    async getProfile(user_id) {
        //let response = await axios.get(`http://localhost:8001/api/getProfile?user_id=${user_id}`);
        let response = await InnerCommunicationService.get(`/api/getProfile?user_id=${user_id}`, 8001);
        if (response.status === 200) {
            return response.data.data;
        } else {
            return undefined;
        }
    }

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

    async getChatMember(req, res) {
        let user = req.user;
        try {
            let {chat_id, user_id} = req.query;
            if (!user.is_server) {
                return res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                })
            }

            let member = await ChatsModel.getChatMember(chat_id, user_id);
            if (member) {
                return res.status(200).json({
                    success: true,
                    data: {
                        member
                    }
                })
            }

        } catch (e) {
            console.log(e);
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async getChatMembers(req, res) {
        let user = req.user;
        try {
            let {chat_id} = req.query;

            if (!user.is_server) {
                return res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                })
            }

            let members = await ChatsModel.getChatMembers(chat_id);
            if (members) {
                return res.status(200).json({
                    success: true,
                    data: {
                        members
                    }
                })
            }

        } catch (e) {
            console.log(e);
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async getChatById(req, res) {
        let user = req.user;
        try {
            let {chat_id} = req.query;

            if (!user.is_server) {
                return res.status(200).json({
                    success: false,
                    error: "Permission_denied"
                })
            }

            let chat = await ChatsModel.getChatById(chat_id);
            if (chat) {
                return res.status(200).json({
                    success: true,
                    data: chat
                })
            }

        } catch (e) {
            console.log(e);
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async getChatInfo(req, res) {
        const user = req.user;
        try {
            let {chat_id, last_message_id = undefined, other_user_id} = req.query;


            if (!chat_id && !other_user_id) {
                return res.status(400).json({
                    success: false,
                    error: 'chat_id or other_user_id is required'
                });
            }

            if (other_user_id) {
                let getRes = await ChatsModel.getChatByOtherUserId(user.user_id, other_user_id);
                if (!getRes) {
                    return res.status(200).json({
                        success: false,
                        error: 'chat_not_found'
                    });
                }
                chat_id = getRes.chat_id;
            }


            let chat = await ChatsModel.getChatById(chat_id);
            if (!chat) {
                return res.status(400).json({
                    success: false,
                    error: 'chat_not_exists'
                });
            }

            let chat_name = chat.chat_name;
            let is_ls = chat.is_ls;

            if (!await ChatsModel.getChatMember(chat_id, user.user_id)) {
                return res.status(403).json({
                    success: false,
                    error: 'access denied'
                });
            }

            const messagesReq = InnerCommunicationService.get("/api/getMessages?chat_id=" + chat_id, 8003);
            const members = await ChatsModel.getChatMembers(chat_id);

            let messagesResponse = await messagesReq;
            let messages = [];

            if (messagesResponse.status === 200 && !messagesResponse.data.success) {
                messages = messagesResponse.data.data;
            }

            let userIds = new Set();
            for (let message of messages) {
                userIds.add(message.user_id);
            }

            for (let member of members) {
                userIds.add(member.user_id)
            }

            let profiles = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from(userIds))}`, 8001)

            let userProfiles = profiles.data.data.profiles;

            res.status(200).json({
                success: true,
                data: {messages, userProfiles, members, chat_name, is_ls, chat_id}
            });
        } catch (e) {
            console.log(e)
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async joinChat(req, res) {
        const user = req.user;
        try {
            let chat_id = await ChatsModel.getChatIdByInviteLink(req.query.link);

            if (!chat_id) {
                return res.status(404).json({
                    success: false,
                    error: "Чат не найден"
                });
            }

            let chat = await ChatsModel.getChatById(chat_id);
            if (!chat) {
                return res.status(404).json({
                    success: false,
                    error: "Чат не найден"
                });
            }

            let member = await ChatsModel.getChatMember(chat_id, user.user_id, false);
            if (member) {
                return res.status(200).json({
                    success: true
                });
            }

            let joinRes = await ChatsModel.joinChatByInviteLink(user.user_id, req.query.link);
            if (joinRes.error) {
                return res.status(500).json({
                    success: false,
                    error: "Чат не найден"
                });
            } else if (joinRes.joined) {
                let profile = await this.getProfile(user.user_id);

                if (!profile) {
                    return res.status(500).json({
                        success: false,
                        error: "Произошла ошибка"
                    });
                }

                await brokerConnector.sendToAllChatMembers({
                    type: "chatMemberJoined",
                    success: true,
                    data: {
                        chat_id: chat.chat_id,
                        user_id: user.user_id,
                        nickname: profile.nickname
                    }
                }, chat.chat_id, user.user_id, false);
                return res.status(200).json({
                    success: true
                });
            }
        } catch (e) {
            console.log(e)
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async getChats(req, res) {
        const user = req.user;
        try {
            let filters = {}
            if (req.query.filters) {
                filters = JSON.parse(req.query.filters)
            }

            const chats = await ChatsModel.getChats(user.user_id, filters);

            let chatIds = [];
            let chatsMap = new Map();
            let usersIds = new Set();

            for (let chat of chats) {
                let chat_id = Number.parseInt(chat.chat_id);
                chatIds.push(chat_id);
                chat.last_message_timestamp = chat.created_time;
                chatsMap.set(chat_id, chat);
            }

            let messagesResponse = await InnerCommunicationService.post('/api/getLastMessageByChat', {
                chatsIds: chatIds
            }, 8003);

            if (messagesResponse.status === 200 && messagesResponse.data.success) {
                let messages = messagesResponse.data.data;

                for (let msg of messages) {
                    let chat = chatsMap.get(msg.chat_id);
                    if (!chat) continue;

                    chat.last_message_id = msg.message_id;
                    chat.last_message_text = msg.text;
                    chat.last_message_user_id = msg.user_id;
                    chat.last_message_timestamp = msg.timestamp;

                    if (chat.last_message_user_id) usersIds.add(chat.last_message_user_id);
                    if (chat.other_user_id) usersIds.add(chat.other_user_id);
                }

            }

            let userProfiles = [];
            if (usersIds.size) {
                let result = await InnerCommunicationService.get(`/api/getUserProfilesByIds?ids=${JSON.stringify(Array.from(usersIds))}`, 8001)
                userProfiles = result.data.data.profiles;
            }

            res.status(200).json({
                success: true,
                data: {chats, userProfiles}
            });
        } catch (e) {
            console.log(e)
        }

        return res.status(200).json({
            success: false,
            error: "Unknown_error"
        })
    }

    async getOrCreateInvitationLink(req, res) {
        const user = req.user;
        try {
            const {chat_id} = req.query;
            if (!chat_id) {
                return res.status(400).json({
                    success: false,
                    error: 'chat_id is required'
                });
            }

            if (!await ChatsModel.getChatMember(chat_id, user.user_id)) {
                return res.status(403).json({
                    success: false,
                    error: 'access denied'
                });
            }

            let inviteLink = await ChatsModel.getOrCreateInvitationLink(chat_id, user.user_id);

            if (!inviteLink) {
                return res.status(400).json({
                    success: false,
                    error: 'Unknown_error'
                });
            }

            inviteLink = "http://localhost:9000/joinChat/" + inviteLink;

            res.status(200).json({
                success: true,
                data: {
                    link: inviteLink
                }
            });
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

            let {chat_name, other_user_id} = req.body;
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

        //TODO при удалении чата прокинуть ивент в брокер
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