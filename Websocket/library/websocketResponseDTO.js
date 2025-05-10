export default function websocketResponseDTO(msg, success, payload, error, error_field) {
    let resp = {
        type: msg.type + "Resp",
        success: success,
    };

    if (msg.localCode) {
        resp["localCode"] = msg.localCode;
    }

    if (error) {
        resp["error"] = error;
    }

    if (error_field) {
        resp["error_field"] = error_field;
    }

    if (payload) {
        resp["data"] = payload;
    }

    return resp;
}