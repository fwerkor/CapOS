#include "common.hpp"
#include "snap.hpp"

#include <set>

using namespace capos;

namespace {

std::string effectivePathInfo() {
    auto path = getenvOrEmpty("PATH_INFO");
    if (!path.empty()) return path;
    auto uri = getenvOrEmpty("REQUEST_URI");
    const auto question = uri.find('?');
    if (question != std::string::npos) uri.resize(question);
    const std::string prefix = "/cgi-bin/cap/api";
    if (uri.rfind(prefix, 0) == 0) return uri.substr(prefix.size());
    return "";
}

std::string sessionJson(const Session& session) {
    std::ostringstream out;
    out << "{\"authenticated\":true"
        << ",\"username\":\"" << jsonEscape(session.username) << "\""
        << ",\"uid\":" << static_cast<unsigned long>(session.uid)
        << ",\"is_sudo\":" << (session.is_sudo ? "true" : "false") << '}';
    return out.str();
}

std::optional<Session> requireSession() {
    const auto session = currentSession();
    if (!session.has_value()) {
        sendJson(401, jsonError("authentication required", "UNAUTHENTICATED"));
        return std::nullopt;
    }
    return session;
}

void handleRoot() {
    sendJson(200, "{\"ok\":true,\"service\":\"capos-webdesktop-api\",\"app_backend\":\"snapd\"}");
}

void handleLogin() {
    if (getenvOrEmpty("REQUEST_METHOD") != "POST") {
        sendJson(405, jsonError("method not allowed", "METHOD_NOT_ALLOWED"));
        return;
    }
    const auto form = parseKv(readRequestBody());
    const auto username = form.find("username");
    const auto password = form.find("password");
    if (username == form.end() || password == form.end()) {
        sendJson(400, jsonError("username and password are required", "INVALID_REQUEST"));
        return;
    }

    uid_t uid = 0;
    std::string error;
    if (!verifyPassword(username->second, password->second, uid, error)) {
        sendJson(401, jsonError(error, "INVALID_CREDENTIALS"));
        return;
    }

    Session session;
    session.id = randomHex(24);
    session.username = username->second;
    session.uid = uid;
    session.is_sudo = userIsSudo(session.username);
    session.created_at = std::time(nullptr);
    session.expires_at = session.created_at + kSessionTtl;
    if (!saveSession(session)) {
        sendJson(500, jsonError("failed to persist session"));
        return;
    }
    cleanupExpiredSessions();
    sendJson(200, "{\"ok\":true,\"session\":" + sessionJson(session) + "}",
             {{"Set-Cookie", sessionCookieHeader(session.id, kSessionTtl)}});
}

void handleLogout() {
    if (const auto session = currentSession(); session.has_value()) deleteSession(session->id);
    sendJson(200, "{\"ok\":true}", {{"Set-Cookie", sessionCookieHeader("", 0)}});
}

void handleSessionInfo() {
    const auto session = currentSession();
    if (!session.has_value()) {
        sendJson(200, "{\"ok\":true,\"authenticated\":false}");
        return;
    }
    sendJson(200, "{\"ok\":true,\"authenticated\":true,\"session\":" + sessionJson(*session) + "}");
}

void sendSnapdResponse(const SnapdHttpResponse& response) {
    if (response.body.empty()) {
        sendJson(response.status, jsonError("empty response from snapd", "SNAPD_PROTOCOL"));
        return;
    }
    sendJson(response.status, response.body);
}

void handleSystemInfo() {
    sendSnapdResponse(snapdRequest("GET", "/v2/system-info"));
}

void handleSnapFind(const std::map<std::string, std::string>& query) {
    const auto it = query.find("q");
    if (it == query.end() || trim(it->second).empty()) {
        sendJson(400, jsonError("q is required", "INVALID_REQUEST"));
        return;
    }
    sendSnapdResponse(snapdRequest("GET", "/v2/find?q=" + percentEncode(trim(it->second))));
}

void handleSnapList() {
    sendSnapdResponse(snapdRequest("GET", "/v2/snaps"));
}

void handleSnapApps(const std::map<std::string, std::string>& query) {
    std::string path = "/v2/apps";
    std::vector<std::string> params;
    if (const auto it = query.find("names"); it != query.end() && !it->second.empty())
        params.push_back("names=" + percentEncode(it->second));
    if (const auto it = query.find("select"); it != query.end() && !it->second.empty())
        params.push_back("select=" + percentEncode(it->second));
    if (!params.empty()) {
        path += '?';
        for (size_t i = 0; i < params.size(); ++i) {
            if (i) path += '&';
            path += params[i];
        }
    }
    sendSnapdResponse(snapdRequest("GET", path));
}

void handleSnapAction(const Session& session, const std::string& snapName, const std::string& action) {
    if (getenvOrEmpty("REQUEST_METHOD") != "POST") {
        sendJson(405, jsonError("method not allowed", "METHOD_NOT_ALLOWED"));
        return;
    }
    if (!session.is_sudo) {
        sendJson(403, jsonError("Snap installation and updates require sudo access", "SUDO_REQUIRED"));
        return;
    }
    if (!validSnapName(snapName)) {
        sendJson(400, jsonError("invalid snap name", "INVALID_SNAP_NAME"));
        return;
    }
    static const std::set<std::string> allowed = {"install", "remove", "refresh", "revert", "enable", "disable"};
    if (!allowed.count(action)) {
        sendJson(400, jsonError("unsupported snap action", "INVALID_ACTION"));
        return;
    }

    std::string payload = "{\"action\":\"" + jsonEscape(action) + "\"";
    if (action == "install") {
        const auto form = parseKv(readRequestBody());
        if (const auto channel = form.find("channel"); channel != form.end() && !channel->second.empty())
            payload += ",\"channel\":\"" + jsonEscape(channel->second) + "\"";
        if (const auto confinement = form.find("confinement"); confinement != form.end() && !confinement->second.empty()) {
            if (confinement->second == "classic") payload += ",\"classic\":true";
            else if (confinement->second == "devmode") payload += ",\"devmode\":true";
            else if (confinement->second != "strict") {
                sendJson(400, jsonError("invalid snap confinement", "INVALID_CONFINEMENT"));
                return;
            }
        }
    }
    payload += '}';
    sendSnapdResponse(snapdRequest("POST", "/v2/snaps/" + percentEncode(snapName), payload));
}

void handleSnapServiceAction(const Session& session, const std::string& snapName, const std::string& action) {
    if (getenvOrEmpty("REQUEST_METHOD") != "POST") {
        sendJson(405, jsonError("method not allowed", "METHOD_NOT_ALLOWED"));
        return;
    }
    if (!session.is_sudo) {
        sendJson(403, jsonError("Service control requires sudo access", "SUDO_REQUIRED"));
        return;
    }
    if (!validSnapName(snapName)) {
        sendJson(400, jsonError("invalid snap name", "INVALID_SNAP_NAME"));
        return;
    }
    static const std::set<std::string> allowed = {"start", "stop", "restart"};
    if (!allowed.count(action)) {
        sendJson(400, jsonError("unsupported service action", "INVALID_ACTION"));
        return;
    }
    const auto payload = "{\"action\":\"" + jsonEscape(action) +
        "\",\"names\":[\"" + jsonEscape(snapName) + "\"],\"scope\":[\"system\"]}";
    sendSnapdResponse(snapdRequest("POST", "/v2/apps", payload));
}

void handleSnapChange(const std::string& changeId) {
    if (changeId.empty() || !std::all_of(changeId.begin(), changeId.end(), [](unsigned char ch) { return std::isdigit(ch); })) {
        sendJson(400, jsonError("invalid change id", "INVALID_CHANGE_ID"));
        return;
    }
    sendSnapdResponse(snapdRequest("GET", "/v2/changes/" + changeId));
}

void handleSnapEndpoints(const std::string& snapName) {
    if (!validSnapName(snapName)) {
        sendJson(400, jsonError("invalid snap name", "INVALID_SNAP_NAME"));
        return;
    }
    sendJson(200, endpointsJson(snapName, discoverSnapEndpoints(snapName)));
}

}  // namespace

int main() {
    cleanupExpiredSessions();
    const auto path = effectivePathInfo();
    const auto segments = splitPath(path);
    const auto query = parseKv(getenvOrEmpty("QUERY_STRING"));

    if (segments.empty()) {
        handleRoot();
        return 0;
    }
    if (segments[0] == "login") {
        handleLogin();
        return 0;
    }
    if (segments[0] == "logout") {
        handleLogout();
        return 0;
    }
    if (segments[0] == "session") {
        handleSessionInfo();
        return 0;
    }

    const auto session = requireSession();
    if (!session.has_value()) return 0;

    if (segments[0] == "me") {
        sendJson(200, "{\"ok\":true,\"session\":" + sessionJson(*session) + "}");
        return 0;
    }
    if (segments[0] == "system") {
        handleSystemInfo();
        return 0;
    }
    if (segments[0] == "snapd") {
        if (segments.size() == 2 && segments[1] == "find") handleSnapFind(query);
        else if (segments.size() == 2 && segments[1] == "snaps") handleSnapList();
        else if (segments.size() == 2 && segments[1] == "apps") handleSnapApps(query);
        else if (segments.size() == 3 && segments[1] == "changes") handleSnapChange(segments[2]);
        else if (segments.size() == 4 && segments[1] == "snaps" && segments[3] == "endpoints") handleSnapEndpoints(segments[2]);
        else if (segments.size() == 4 && segments[1] == "snaps") handleSnapAction(*session, segments[2], segments[3]);
        else if (segments.size() == 5 && segments[1] == "snaps" && segments[3] == "service") handleSnapServiceAction(*session, segments[2], segments[4]);
        else sendJson(404, jsonError("not found", "NOT_FOUND"));
        return 0;
    }

    sendJson(404, jsonError("not found", "NOT_FOUND"));
    return 0;
}
