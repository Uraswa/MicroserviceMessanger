import ChatsModel from "../Model/ChatsModel.js";

//options all, not_ls, ls
export default function (type = 'all') {
    return async function (req, res, next) {

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

        if (type !== 'all' && (chat.is_ls && type === 'not_ls' || !chat.is_ls && type === 'ls')) {

            return res.status(200).json({
                success: false,
                error: "Permission_denied"
            })
        }

        req.chat = chat;
        next();
    }
}

