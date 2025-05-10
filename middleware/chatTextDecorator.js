export default function (req, res, next) {
    let text = req.body.text;
    if (!text || text.length > 256) {

        return res.status(200).json({
            success: false,
            error: "Message_len"
        });
    }

    next();
}