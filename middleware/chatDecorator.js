import ChatsModel from "../Model/ChatsModel.js";

export default async function (req, res, next) {

    let chat_id = req.body.chat_id;
    if (!chat_id) {
        chat_id = req.query.chat_id;
    }

    if (!chat_id) {
        return res.status(200).json({
                success: false,
                error: "Чат не найден"
            })
    }

    let chat = await ChatsModel.getChatById(chat_id);

    if (!chat) {

        return res.status(200).json({
            success: false,
            error: "Chat_not_exist"
        })
    }
    req.chat = chat;
    next();
}