include $(TOPDIR)/rules.mk

PKG_NAME:=capos-webdesktop
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)
$(shell mkdir -p $(PKG_BUILD_DIR))

include $(INCLUDE_DIR)/package.mk

define Package/capos-webdesktop
  SECTION:=capos
  CATEGORY:=CapOS
  TITLE:=CapOS WebDesktop
  DEPENDS:=+libstdcpp +libopenssl +luci +uhttpd +libustream-mbedtls +px5g-mbedtls +snapd
endef

define Package/capos-webdesktop/description
 Build and install CapOS WebDesktop CGI binaries and static web assets.
endef

CAP_CGI_DIR:=/www/cgi-bin/cap
CAP_WWW_DIR:=/www/cap

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/src
	$(CP) -a ./src/* $(PKG_BUILD_DIR)/src/
endef

define Build/Compile
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/bin

	$(TARGET_CXX) $(TARGET_CXXFLAGS) $(TARGET_CPPFLAGS) -std=gnu++17 -I$(PKG_BUILD_DIR)/src \
		-o $(PKG_BUILD_DIR)/bin/api $(PKG_BUILD_DIR)/src/api.cpp \
		$(TARGET_LDFLAGS) -lcrypt -lssl -lcrypto

	$(TARGET_CXX) $(TARGET_CXXFLAGS) $(TARGET_CPPFLAGS) -std=gnu++17 -I$(PKG_BUILD_DIR)/src \
		-o $(PKG_BUILD_DIR)/bin/app $(PKG_BUILD_DIR)/src/app.cpp \
		$(TARGET_LDFLAGS) -lcrypt -lssl -lcrypto
endef

define Package/capos-webdesktop/install
	$(INSTALL_DIR) $(1)$(CAP_CGI_DIR)
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/bin/api $(1)$(CAP_CGI_DIR)/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/bin/app $(1)$(CAP_CGI_DIR)/

	$(INSTALL_DIR) $(1)$(CAP_WWW_DIR)
	$(CP) -a ./htdocs/* $(1)$(CAP_WWW_DIR)/

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/90-capos-webdesktop-uhttpd $(1)/etc/uci-defaults/90-capos-webdesktop-uhttpd
endef

$(eval $(call BuildPackage,capos-webdesktop))
