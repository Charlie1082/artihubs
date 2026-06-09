const { publicError, requestId, sendJson } = require("../_utils/http");

module.exports = async function handler(request, response) {
  const id = requestId();

  if (request.method !== "GET") {
    sendJson(response, 405, {
      ok: false,
      error: publicError("METHOD_NOT_ALLOWED", "Method not allowed."),
      requestId: id
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    data: {
      service: "artihubs-api",
      version: "v1"
    },
    requestId: id
  });
};
