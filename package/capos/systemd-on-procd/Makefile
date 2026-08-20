include $(TOPDIR)/rules.mk

PKG_NAME:=systemd-on-procd
PKG_VERSION:=0.1.7
PKG_RELEASE:=1

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/fwerkor/systemd-on-procd/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=d8e7d413869b544b0754a4b7b65dfc80cda557394e3ecfeaab74ba6997233b17
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)
PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/fwerkor/systemd-on-procd
GO_PKG_BUILD_PKG:=$(GO_PKG)/cmd/systemd-on-procd

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/systemd-on-procd
  SECTION:=capos
  CATEGORY:=CapOS
  TITLE:=systemd command compatibility backed by procd
  URL:=https://github.com/fwerkor/systemd-on-procd
  DEPENDS:=$(GO_ARCH_DEPENDS) +procd +ubus
endef

define Package/systemd-on-procd/description
 A focused systemd command and unit compatibility layer that keeps procd as
 PID 1. It provides systemctl/systemd-run/systemd-mount entry points for
 systemd-centric software such as snapd.
endef

define Package/systemd-on-procd/install
	$(INSTALL_DIR) $(1)/usr/libexec/systemd-on-procd
	$(INSTALL_BIN) $(GO_PKG_BUILD_BIN_DIR)/systemd-on-procd $(1)/usr/libexec/systemd-on-procd/systemd-on-procd
	$(INSTALL_DIR) $(1)/usr/bin
	$(LN) ../libexec/systemd-on-procd/systemd-on-procd $(1)/usr/bin/systemctl
	$(LN) ../libexec/systemd-on-procd/systemd-on-procd $(1)/usr/bin/systemd-run
	$(LN) ../libexec/systemd-on-procd/systemd-on-procd $(1)/usr/bin/systemd-mount
	$(LN) ../libexec/systemd-on-procd/systemd-on-procd $(1)/usr/bin/systemd-detect-virt
endef

$(eval $(call GoBinPackage,systemd-on-procd))
$(eval $(call BuildPackage,systemd-on-procd))
