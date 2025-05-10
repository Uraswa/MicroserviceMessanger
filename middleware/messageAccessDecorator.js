import MessagesModel from "../Model/MessagesModel.js";

export default (isAdminActionAvailable) => {


    return async (req, res, next) => {

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


        let message = await MessagesModel.getMessageById(chat_id, req.body.message_id);
        if (!message) {
            return res.status(200).json({
                success: false,
                error: "Message_not_exist"
            })
        }

        if (message.user_id !== req.user.user_id && (!isAdminActionAvailable || isAdminActionAvailable && !req.member.is_admin)) {
            return res.status(200).json({
                success: false,
                error: "Permission_denied"
            })
        }

        req.message = message;
        next();
    }
}