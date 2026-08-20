#ifndef CAPOS_WEBDESKTOP_SNAP_HPP
#define CAPOS_WEBDESKTOP_SNAP_HPP

#include "common.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <openssl/ssl.h>
#include <poll.h>
#include <set>
#include <sys/socket.h>
#include <sys/un.h>

namespace capos {

struct SnapdHttpResponse {
    int status = 502;
    std::string body;
    std::map<std::string, std::string> headers;
};

inline std::string lowerAsciiCopy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

inline std::string percentEncode(const std::string& input) {
    std::ostringstream out;
    for (unsigned char ch : input) {
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
            (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' || ch == '~') {
            out << static_cast<char>(ch);
        } else {
            out << '%' << std::uppercase << std::hex << std::setw(2) << std::setfill('0')
                << static_cast<int>(ch) << std::nouppercase << std::dec << std::setfill(' ');
        }
    }
    return out.str();
}

inline std::optional<std::string> decodeChunkedPayload(const std::string& input) {
    std::string out;
    size_t pos = 0;
    while (pos < input.size()) {
        auto lineEnd = input.find("\r\n", pos);
        size_t sep = 2;
        if (lineEnd == std::string::npos) {
            lineEnd = input.find('\n', pos);
            sep = 1;
        }
        if (lineEnd == std::string::npos) return std::nullopt;
        auto token = trim(input.substr(pos, lineEnd - pos));
        const auto semicolon = token.find(';');
        if (semicolon != std::string::npos) token.resize(semicolon);
        char* end = nullptr;
        const auto len = std::strtoull(token.c_str(), &end, 16);
        if (end == nullptr || *end != '\0') return std::nullopt;
        pos = lineEnd + sep;
        if (len == 0) return out;
        if (pos + len > input.size()) return std::nullopt;
        out.append(input, pos, static_cast<size_t>(len));
        pos += static_cast<size_t>(len);
        if (input.compare(pos, 2, "\r\n") == 0) pos += 2;
        else if (input.compare(pos, 1, "\n") == 0) pos += 1;
        else return std::nullopt;
    }
    return std::nullopt;
}

inline SnapdHttpResponse snapdRequest(const std::string& method, const std::string& path,
                                      const std::string& body = {}) {
    SnapdHttpResponse response;
    const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        response.body = jsonError("cannot create snapd socket", "SNAPD_UNAVAILABLE");
        return response;
    }

    timeval timeout{};
    timeout.tv_sec = 8;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", "/run/snapd.socket");
    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        ::close(fd);
        response.body = jsonError("snapd is not running", "SNAPD_UNAVAILABLE");
        return response;
    }

    std::ostringstream request;
    request << method << ' ' << path << " HTTP/1.1\r\n"
            << "Host: localhost\r\n"
            << "Connection: close\r\n"
            << "Accept: application/json\r\n";
    if (!body.empty()) {
        request << "Content-Type: application/json\r\n"
                << "Content-Length: " << body.size() << "\r\n";
    }
    request << "\r\n" << body;
    const auto wire = request.str();
    size_t sent = 0;
    while (sent < wire.size()) {
        const auto n = ::send(fd, wire.data() + sent, wire.size() - sent, MSG_NOSIGNAL);
        if (n <= 0) {
            ::close(fd);
            response.body = jsonError("failed to send request to snapd", "SNAPD_IO");
            return response;
        }
        sent += static_cast<size_t>(n);
    }

    std::string raw;
    std::array<char, 8192> buffer{};
    while (true) {
        const auto n = ::recv(fd, buffer.data(), buffer.size(), 0);
        if (n == 0) break;
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        raw.append(buffer.data(), static_cast<size_t>(n));
    }
    ::close(fd);

    const auto headerEnd = raw.find("\r\n\r\n");
    if (headerEnd == std::string::npos) {
        response.body = jsonError("invalid response from snapd", "SNAPD_PROTOCOL");
        return response;
    }
    std::stringstream headers(raw.substr(0, headerEnd));
    std::string line;
    if (std::getline(headers, line)) {
        std::smatch match;
        if (std::regex_search(line, match, std::regex(R"(^HTTP/\d+\.\d+\s+(\d+))"))) {
            response.status = std::stoi(match[1].str());
        }
    }
    while (std::getline(headers, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const auto colon = line.find(':');
        if (colon == std::string::npos) continue;
        response.headers[lowerAsciiCopy(trim(line.substr(0, colon)))] = trim(line.substr(colon + 1));
    }
    response.body = raw.substr(headerEnd + 4);
    const auto transfer = response.headers.find("transfer-encoding");
    if (transfer != response.headers.end() && lowerAsciiCopy(transfer->second).find("chunked") != std::string::npos) {
        if (auto decoded = decodeChunkedPayload(response.body); decoded.has_value()) response.body = *decoded;
    }
    return response;
}

inline bool validSnapName(const std::string& name) {
    if (name.empty() || name.size() > 64 || name.front() == '-' || name.back() == '-') return false;
    bool hasLetter = false;
    for (const auto ch : name) {
        if (ch >= 'a' && ch <= 'z') hasLetter = true;
        else if (!(ch >= '0' && ch <= '9') && ch != '-') return false;
    }
    return hasLetter;
}

struct SnapEndpoint {
    int port = 0;
    std::string protocol = "tcp";
    bool web = false;
    int score = 0;
    std::string evidence;
};

inline std::optional<std::string> snapNameForPid(const std::string& pid) {
    const auto env = readFile("/proc/" + pid + "/environ");
    if (!env.has_value()) return std::nullopt;
    size_t pos = 0;
    while (pos < env->size()) {
        const auto end = env->find('\0', pos);
        const auto item = env->substr(pos, end == std::string::npos ? std::string::npos : end - pos);
        for (const auto* key : {"SNAP_INSTANCE_NAME=", "SNAP_NAME="}) {
            if (item.rfind(key, 0) == 0) {
                const auto value = item.substr(std::strlen(key));
                if (validSnapName(value)) return value;
            }
        }
        if (end == std::string::npos) break;
        pos = end + 1;
    }
    return std::nullopt;
}

inline std::set<std::string> socketInodesForSnap(const std::string& snapName) {
    std::set<std::string> inodes;
    DIR* proc = ::opendir("/proc");
    if (proc == nullptr) return inodes;
    while (auto* entry = ::readdir(proc)) {
        const std::string pid = entry->d_name;
        if (pid.empty() || !std::all_of(pid.begin(), pid.end(), [](unsigned char ch) { return std::isdigit(ch); })) continue;
        const auto owner = snapNameForPid(pid);
        if (!owner.has_value() || *owner != snapName) continue;
        const auto fdDirPath = "/proc/" + pid + "/fd";
        DIR* fds = ::opendir(fdDirPath.c_str());
        if (fds == nullptr) continue;
        while (auto* fdEntry = ::readdir(fds)) {
            if (fdEntry->d_name[0] == '.') continue;
            std::array<char, 256> target{};
            const auto fdPath = fdDirPath + "/" + fdEntry->d_name;
            const auto n = ::readlink(fdPath.c_str(), target.data(), target.size() - 1);
            if (n <= 0) continue;
            target[static_cast<size_t>(n)] = '\0';
            std::string link(target.data());
            if (link.rfind("socket:[", 0) == 0 && link.back() == ']') {
                inodes.insert(link.substr(8, link.size() - 9));
            }
        }
        ::closedir(fds);
    }
    ::closedir(proc);
    return inodes;
}

inline void collectListeningPorts(const std::string& tablePath, const std::set<std::string>& inodes, std::set<int>& ports) {
    std::ifstream in(tablePath);
    std::string line;
    std::getline(in, line);
    while (std::getline(in, line)) {
        std::stringstream row(line);
        std::vector<std::string> fields;
        std::string field;
        while (row >> field) fields.push_back(field);
        if (fields.size() < 10 || fields[3] != "0A" || inodes.find(fields[9]) == inodes.end()) continue;
        const auto colon = fields[1].find(':');
        if (colon == std::string::npos) continue;
        char* end = nullptr;
        const auto value = std::strtol(fields[1].substr(colon + 1).c_str(), &end, 16);
        if (end != nullptr && *end == '\0' && value > 0 && value <= 65535) ports.insert(static_cast<int>(value));
    }
}

inline std::optional<std::string> probePlainHttp(int port) {
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return std::nullopt;
    timeval timeout{}; timeout.tv_sec = 1;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    sockaddr_in addr{}; addr.sin_family = AF_INET; addr.sin_port = htons(static_cast<uint16_t>(port)); addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) { ::close(fd); return std::nullopt; }
    const std::string req = "GET / HTTP/1.0\r\nHost: localhost\r\nAccept: text/html,*/*\r\nConnection: close\r\n\r\n";
    if (::send(fd, req.data(), req.size(), MSG_NOSIGNAL) <= 0) { ::close(fd); return std::nullopt; }
    std::array<char, 8192> buf{}; const auto n = ::recv(fd, buf.data(), buf.size(), 0); ::close(fd);
    if (n <= 0) return std::nullopt;
    std::string data(buf.data(), static_cast<size_t>(n));
    if (data.rfind("HTTP/", 0) != 0) return std::nullopt;
    return data;
}

inline std::optional<std::string> probeTlsHttp(int port) {
    SSL_CTX* ctx = SSL_CTX_new(TLS_client_method());
    if (ctx == nullptr) return std::nullopt;
    SSL_CTX_set_verify(ctx, SSL_VERIFY_NONE, nullptr);
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { SSL_CTX_free(ctx); return std::nullopt; }
    timeval timeout{}; timeout.tv_sec = 1;
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    sockaddr_in addr{}; addr.sin_family = AF_INET; addr.sin_port = htons(static_cast<uint16_t>(port)); addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) { ::close(fd); SSL_CTX_free(ctx); return std::nullopt; }
    SSL* ssl = SSL_new(ctx);
    SSL_set_fd(ssl, fd); SSL_set_tlsext_host_name(ssl, "localhost");
    if (SSL_connect(ssl) != 1) { SSL_free(ssl); ::close(fd); SSL_CTX_free(ctx); return std::nullopt; }
    const std::string req = "GET / HTTP/1.0\r\nHost: localhost\r\nAccept: text/html,*/*\r\nConnection: close\r\n\r\n";
    if (SSL_write(ssl, req.data(), static_cast<int>(req.size())) <= 0) { SSL_free(ssl); ::close(fd); SSL_CTX_free(ctx); return std::nullopt; }
    std::array<char, 8192> buf{}; const auto n = SSL_read(ssl, buf.data(), static_cast<int>(buf.size()));
    SSL_free(ssl); ::close(fd); SSL_CTX_free(ctx);
    if (n <= 0) return std::nullopt;
    std::string data(buf.data(), static_cast<size_t>(n));
    if (data.rfind("HTTP/", 0) != 0) return std::nullopt;
    return data;
}

inline SnapEndpoint scoreWebProbe(int port, const std::string& scheme, const std::string& response) {
    SnapEndpoint endpoint; endpoint.port = port; endpoint.protocol = scheme; endpoint.web = true; endpoint.score = scheme == "https" ? 85 : 80;
    const auto lower = lowerAsciiCopy(response);
    if (lower.find("content-type: text/html") != std::string::npos || lower.find("<html") != std::string::npos || lower.find("<!doctype html") != std::string::npos) {
        endpoint.score += 45; endpoint.evidence = "html";
    } else if (lower.find("location:") != std::string::npos) {
        endpoint.score += 25; endpoint.evidence = "http-redirect";
    } else {
        endpoint.evidence = "http";
    }
    if (port == 80 || port == 443 || port == 8080 || port == 8000 || port == 8443) endpoint.score += 5;
    return endpoint;
}

inline std::string endpointCachePath(const std::string& snapName) {
    return "/tmp/capos-webdesktop/endpoints/" + snapName + ".cache";
}

inline void cacheSnapEndpoints(const std::string& snapName, const std::vector<SnapEndpoint>& endpoints) {
    std::ostringstream data;
    data << std::time(nullptr) << '\n';
    for (const auto& ep : endpoints) {
        data << ep.port << '\t' << ep.protocol << '\t' << (ep.web ? 1 : 0) << '\t'
             << ep.score << '\t' << ep.evidence << '\n';
    }
    writeFile(endpointCachePath(snapName), data.str());
}

inline std::optional<std::vector<SnapEndpoint>> readSnapEndpointCache(const std::string& snapName, std::time_t ttlSeconds) {
    const auto content = readFile(endpointCachePath(snapName));
    if (!content.has_value()) return std::nullopt;
    std::stringstream stream(*content);
    std::string line;
    if (!std::getline(stream, line)) return std::nullopt;
    const auto storedAt = static_cast<std::time_t>(std::strtoll(line.c_str(), nullptr, 10));
    const auto now = std::time(nullptr);
    if (storedAt <= 0 || now < storedAt || now - storedAt > ttlSeconds) return std::nullopt;

    std::vector<SnapEndpoint> endpoints;
    while (std::getline(stream, line)) {
        std::stringstream row(line);
        std::string port, protocol, web, score, evidence;
        if (!std::getline(row, port, '\t') || !std::getline(row, protocol, '\t') ||
            !std::getline(row, web, '\t') || !std::getline(row, score, '\t') ||
            !std::getline(row, evidence)) continue;
        SnapEndpoint ep;
        ep.port = std::atoi(port.c_str());
        ep.protocol = protocol;
        ep.web = web == "1";
        ep.score = std::atoi(score.c_str());
        ep.evidence = evidence;
        if (ep.port > 0 && ep.port <= 65535) endpoints.push_back(ep);
    }
    return endpoints;
}

inline void invalidateSnapEndpointCache(const std::string& snapName) {
    std::remove(endpointCachePath(snapName).c_str());
}

inline std::vector<SnapEndpoint> discoverSnapEndpoints(const std::string& snapName) {
    std::vector<SnapEndpoint> result;
    if (!validSnapName(snapName)) return result;
    const auto inodes = socketInodesForSnap(snapName);
    std::set<int> ports;
    collectListeningPorts("/proc/net/tcp", inodes, ports);
    collectListeningPorts("/proc/net/tcp6", inodes, ports);
    for (const auto port : ports) {
        if (auto http = probePlainHttp(port); http.has_value()) result.push_back(scoreWebProbe(port, "http", *http));
        else if (auto https = probeTlsHttp(port); https.has_value()) result.push_back(scoreWebProbe(port, "https", *https));
        else result.push_back(SnapEndpoint{port, "tcp", false, 10, "listen"});
    }
    std::stable_sort(result.begin(), result.end(), [](const SnapEndpoint& a, const SnapEndpoint& b) {
        if (a.web != b.web) return a.web > b.web;
        if (a.score != b.score) return a.score > b.score;
        return a.port < b.port;
    });
    cacheSnapEndpoints(snapName, result);
    return result;
}

inline std::string endpointsJson(const std::string& snapName, const std::vector<SnapEndpoint>& endpoints) {
    std::ostringstream out;
    out << "{\"ok\":true,\"snap\":\"" << jsonEscape(snapName) << "\",\"endpoints\":[";
    for (size_t i = 0; i < endpoints.size(); ++i) {
        if (i) out << ',';
        const auto& ep = endpoints[i];
        out << "{\"port\":" << ep.port
            << ",\"protocol\":\"" << jsonEscape(ep.protocol) << "\""
            << ",\"web\":" << (ep.web ? "true" : "false")
            << ",\"score\":" << ep.score
            << ",\"evidence\":\"" << jsonEscape(ep.evidence) << "\""
            << ",\"primary\":" << (i == 0 && ep.web ? "true" : "false") << '}';
    }
    out << "]}";
    return out.str();
}

inline std::optional<SnapEndpoint> primarySnapWebEndpoint(const std::string& snapName) {
    auto cached = readSnapEndpointCache(snapName, 30);
    const auto endpoints = cached.has_value() ? *cached : discoverSnapEndpoints(snapName);
    for (const auto& endpoint : endpoints) if (endpoint.web) return endpoint;
    return std::nullopt;
}

}  // namespace capos

#endif
