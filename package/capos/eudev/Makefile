include $(TOPDIR)/rules.mk

PKG_NAME:=eudev
PKG_VERSION:=3.2.14
PKG_RELEASE:=2

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/eudev-project/eudev/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=c340e6c51dfc5531ac0c0fa84a34b72162acf525f9023eb9cf4931b782c8f177
PKG_BUILD_DIR:=$(BUILD_DIR)/eudev-$(PKG_VERSION)
PKG_LICENSE:=GPL-2.0-or-later LGPL-2.1-or-later
PKG_LICENSE_FILES:=COPYING
PKG_FIXUP:=autoreconf
PKG_BUILD_DEPENDS:=gperf/host
PKG_INSTALL:=1

include $(INCLUDE_DIR)/package.mk

define Package/eudev
  SECTION:=capos
  CATEGORY:=CapOS
  TITLE:=Standalone udev daemon and udevadm for Snap device mediation
  URL:=https://github.com/eudev-project/eudev
  DEPENDS:=@ARCH_64BIT
  PROVIDES:=libudev-zero
  CONFLICTS:=libudev-zero
endef

define Package/eudev/description
 eudev provides a systemd-independent udev daemon and udevadm. CapOS uses it
 alongside procd so snapd can install and reload device-tagging rules without
 replacing OpenWrt's init or hotplug infrastructure.
endef

CONFIGURE_ARGS += \
	--prefix=/usr \
	--sbindir=/usr/sbin \
	--with-rootprefix=/usr \
	--with-rootlibdir=/usr/lib \
	--with-rootlibexecdir=/usr/lib/udev \
	--with-rootrundir=/run \
	--disable-selinux \
	--disable-blkid \
	--disable-kmod \
	--disable-hwdb \
	--disable-manpages \
	--disable-rule-generator \
	--disable-mtd_probe

define Build/InstallDev
	$(INSTALL_DIR) $(1)/usr/include $(1)/usr/lib/pkgconfig $(1)/usr/lib
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/usr/include/libudev.h $(1)/usr/include/
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/usr/lib/pkgconfig/libudev.pc $(1)/usr/lib/pkgconfig/
	$(CP) $(PKG_INSTALL_DIR)/usr/lib/libudev.so* $(1)/usr/lib/
endef

define Package/eudev/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/usr/sbin $(1)/usr/lib $(1)/usr/lib/udev/rules.d $(1)/etc/udev $(1)/etc/init.d
	$(CP) $(PKG_INSTALL_DIR)/usr/lib/libudev.so.1* $(1)/usr/lib/
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/udevadm $(1)/usr/bin/udevadm
	$(LN) ../bin/udevadm $(1)/usr/sbin/udevadm
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/sbin/udevd $(1)/usr/sbin/udevd
	# Keep OpenWrt responsible for device nodes, permissions and network naming.
	# Only retain eudev classification rules that snapd-generated rules rely on.
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/usr/lib/udev/rules.d/60-input-id.rules $(1)/usr/lib/udev/rules.d/
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/usr/lib/udev/rules.d/60-persistent-input.rules $(1)/usr/lib/udev/rules.d/
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/usr/lib/udev/rules.d/60-serial.rules $(1)/usr/lib/udev/rules.d/
	$(INSTALL_CONF) $(PKG_INSTALL_DIR)/etc/udev/udev.conf $(1)/etc/udev/udev.conf
	$(INSTALL_BIN) ./files/eudev.init $(1)/etc/init.d/eudev
endef

$(eval $(call BuildPackage,eudev))
