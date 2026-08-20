include $(TOPDIR)/rules.mk

PKG_NAME:=snapd
PKG_VERSION:=2.76.2
PKG_RELEASE:=6

PKG_SOURCE:=snapd_$(PKG_VERSION).vendor.tar.xz
PKG_SOURCE_URL:=https://github.com/canonical/snapd/releases/download/$(PKG_VERSION)
PKG_HASH:=873fedb8525057c2b276003c2f90c2e5f7b541ec1bb409a6f489c51b5c72af2b
PKG_BUILD_DIR:=$(BUILD_DIR)/snapd-$(PKG_VERSION)
PKG_BUILD_DEPENDS:=golang/host libseccomp libcap apparmor eudev
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/snapcore/snapd

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

# snapd is built with its upstream packaging/snapd.mk rather than the generic
# OpenWrt Go workspace. Nothing consumes snapd as a staged Go source library.
define Build/InstallDev
endef

define Package/snapd
  SECTION:=capos
  CATEGORY:=CapOS
  TITLE:=Snap package manager daemon
  URL:=https://snapcraft.io/
  DEPENDS:=$(GO_ARCH_DEPENDS) @ARCH_64BIT +systemd-on-procd +libseccomp +libcap +libcap-bin +libapparmor +apparmor-parser +eudev +dbus +ca-bundle +openssh-keygen +kmod-loop +kmod-fs-squashfs +squashfs-tools-unsquashfs
endef

define Package/snapd/description
 The upstream Canonical snapd runtime adapted for CapOS. procd remains PID 1;
 systemd-facing service and mount operations are translated by systemd-on-procd.
endef

SNAPD_GO_BUILD_DIR:=$(PKG_BUILD_DIR)/.capos-go
SNAPD_DATA_VARS:=BINDIR=/usr/bin LIBEXECDIR=/usr/lib DATADIR=/usr/share \
	SYSTEMDSYSTEMUNITDIR=/usr/lib/systemd/system SNAPD_ENVIRONMENT_FILE=/etc/environment \
	USE_CANONICAL_SNAP_MOUNT_DIR=false USE_ALT_SNAP_MOUNT_DIR=true

define Build/Prepare
	$(call Build/Prepare/Default)
	$(SED) 's|AC_CHECK_HEADERS(\[xfs/xqm.h\], \[\], \[AC_MSG_ERROR(xfs/xqm.h unavailable)\])|AC_CHECK_HEADERS([xfs/xqm.h])|' $(PKG_BUILD_DIR)/cmd/configure.ac
	$(SED) 's|SNAP_MOUNT_DIR_SYSTEMD_UNIT="$$(systemd-escape -p "$$STATIC_SNAP_MOUNT_DIR")"|SNAP_MOUNT_DIR_SYSTEMD_UNIT="var-lib-snapd-snap"|' $(PKG_BUILD_DIR)/cmd/configure.ac
	(cd $(PKG_BUILD_DIR) && \
		$(GO_BIN_PATH) GOENV=off GOTOOLCHAIN=local \
		./mkversion.sh $(PKG_VERSION))
endef

define Build/Configure
	(cd $(PKG_BUILD_DIR)/cmd && autoreconf -i -f)
	(cd $(PKG_BUILD_DIR)/cmd && \
		$(TARGET_CONFIGURE_OPTS) \
		PKG_CONFIG_PATH="$(STAGING_DIR)/usr/lib/pkgconfig:$(STAGING_DIR)/usr/share/pkgconfig" \
		./configure \
			--host=$(GNU_TARGET_NAME) \
			--build=$(GNU_HOST_NAME) \
			--prefix=/usr \
			--libexecdir=/usr/lib/snapd \
			--with-apparmorconfigdir=/etc/apparmor.d \
			--with-snap-mount-dir=/var/lib/snapd/snap \
			--without-unit-tests \
			--enable-apparmor \
			--disable-selinux \
			--disable-nvidia-multiarch \
			--disable-nvidia-biarch)
	mkdir -p $(SNAPD_GO_BUILD_DIR)
	printf '%s\n' \
		'prefix=/usr' \
		'bindir=/usr/bin' \
		'sbindir=/usr/sbin' \
		'libexecdir=/usr/lib' \
		'mandir=/usr/share/man' \
		'datadir=/usr/share' \
		'localstatedir=/var/lib' \
		'sharedstatedir=/var/lib' \
		'unitdir=/usr/lib/systemd/system' \
		'builddir=$(SNAPD_GO_BUILD_DIR)' \
		'with_core_bits=0' \
		'with_alt_snap_mount_dir=1' \
		'with_apparmor=1' \
		'with_static_pie=0' \
		'with_vendor=1' \
		'with_testkeys=0' \
		'EXTRA_GO_BUILD_FLAGS=-buildvcs=false -trimpath' \
		> $(PKG_BUILD_DIR)/snapd.defines.mk
endef

define Build/Compile
	+$(MAKE) $(PKG_JOBS) -C $(PKG_BUILD_DIR)/cmd \
		CC="$(TARGET_CC)" CXX="$(TARGET_CXX)" \
		PKG_CONFIG="$(STAGING_DIR_HOST)/bin/pkg-config" \
		CFLAGS="$(TARGET_CFLAGS)" CPPFLAGS="$(TARGET_CPPFLAGS)" LDFLAGS="$(TARGET_LDFLAGS)"
	+cd $(PKG_BUILD_DIR) && $(GO_PKG_VARS) \
		$(MAKE) -f packaging/snapd.mk SNAPD_DEFINES_DIR=$(PKG_BUILD_DIR) all
	+$(MAKE) -C $(PKG_BUILD_DIR)/data $(SNAPD_DATA_VARS) all

	rm -rf $(PKG_INSTALL_DIR)
	$(INSTALL_DIR) $(PKG_INSTALL_DIR)
	+$(MAKE) -C $(PKG_BUILD_DIR)/cmd DESTDIR=$(PKG_INSTALL_DIR) install
	+$(MAKE) -C $(PKG_BUILD_DIR)/data DESTDIR=$(PKG_INSTALL_DIR) $(SNAPD_DATA_VARS) install

	$(INSTALL_DIR) $(PKG_INSTALL_DIR)/usr/lib/snapd $(PKG_INSTALL_DIR)/usr/bin
	$(INSTALL_BIN) $(SNAPD_GO_BUILD_DIR)/snap $(PKG_INSTALL_DIR)/usr/bin/snap
	$(INSTALL_BIN) $(SNAPD_GO_BUILD_DIR)/snapd $(PKG_INSTALL_DIR)/usr/lib/snapd/snapd
	$(INSTALL_BIN) $(SNAPD_GO_BUILD_DIR)/snapctl $(PKG_INSTALL_DIR)/usr/lib/snapd/snapctl
	$(INSTALL_BIN) $(SNAPD_GO_BUILD_DIR)/snap-exec $(PKG_INSTALL_DIR)/usr/lib/snapd/snap-exec
	$(INSTALL_BIN) $(SNAPD_GO_BUILD_DIR)/snap-update-ns $(PKG_INSTALL_DIR)/usr/lib/snapd/snap-update-ns
	$(INSTALL_BIN) $(SNAPD_GO_BUILD_DIR)/snap-seccomp $(PKG_INSTALL_DIR)/usr/lib/snapd/snap-seccomp
	$(INSTALL_BIN) $(SNAPD_GO_BUILD_DIR)/snapd-apparmor $(PKG_INSTALL_DIR)/usr/lib/snapd/snapd-apparmor
	$(LN) ../lib/snapd/snapctl $(PKG_INSTALL_DIR)/usr/bin/snapctl

	$(INSTALL_DIR) \
		$(PKG_INSTALL_DIR)/var/lib/snapd/apparmor/profiles \
		$(PKG_INSTALL_DIR)/var/lib/snapd/apparmor/snap-confine \
		$(PKG_INSTALL_DIR)/var/lib/snapd/assertions \
		$(PKG_INSTALL_DIR)/var/lib/snapd/cache \
		$(PKG_INSTALL_DIR)/var/lib/snapd/cgroup \
		$(PKG_INSTALL_DIR)/var/lib/snapd/cookie \
		$(PKG_INSTALL_DIR)/var/lib/snapd/dbus-1/services \
		$(PKG_INSTALL_DIR)/var/lib/snapd/dbus-1/system-services \
		$(PKG_INSTALL_DIR)/var/lib/snapd/desktop/applications \
		$(PKG_INSTALL_DIR)/var/lib/snapd/device \
		$(PKG_INSTALL_DIR)/var/lib/snapd/environment \
		$(PKG_INSTALL_DIR)/var/lib/snapd/hostfs \
		$(PKG_INSTALL_DIR)/var/lib/snapd/inhibit \
		$(PKG_INSTALL_DIR)/var/lib/snapd/lib/gl \
		$(PKG_INSTALL_DIR)/var/lib/snapd/lib/gl32 \
		$(PKG_INSTALL_DIR)/var/lib/snapd/lib/glvnd \
		$(PKG_INSTALL_DIR)/var/lib/snapd/lib/vulkan \
		$(PKG_INSTALL_DIR)/var/lib/snapd/mount \
		$(PKG_INSTALL_DIR)/var/lib/snapd/seccomp/bpf \
		$(PKG_INSTALL_DIR)/var/lib/snapd/sequence \
		$(PKG_INSTALL_DIR)/var/lib/snapd/snaps \
		$(PKG_INSTALL_DIR)/var/lib/snapd/snap/bin
	$(INSTALL_DIR) $(PKG_INSTALL_DIR)/var/cache/snapd
endef

define Package/snapd/install
	$(CP) $(PKG_INSTALL_DIR)/* $(1)/
	$(INSTALL_DIR) $(1)/etc/init.d $(1)/etc/default
	$(INSTALL_BIN) ./files/snapd.init $(1)/etc/init.d/snapd
	$(INSTALL_CONF) ./files/snapd.default $(1)/etc/default/snapd
	$(INSTALL_DIR) $(1)/etc/systemd/system/multi-user.target.wants
	$(LN) /usr/lib/systemd/system/snapd.apparmor.service $(1)/etc/systemd/system/multi-user.target.wants/snapd.apparmor.service
endef

define Package/snapd/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
if command -v setcap >/dev/null 2>&1 && [ -x /usr/lib/snapd/snap-confine ] && [ -r /usr/lib/snapd/snap-confine.v2-only.caps ]; then
	setcap "$$(cat /usr/lib/snapd/snap-confine.v2-only.caps)" /usr/lib/snapd/snap-confine || true
fi
if command -v apparmor_parser >/dev/null 2>&1 && [ -r /etc/apparmor.d/usr.lib.snapd.snap-confine ]; then
	apparmor_parser -r /etc/apparmor.d/usr.lib.snapd.snap-confine || true
fi
/etc/init.d/snapd enable >/dev/null 2>&1 || true
endef

$(eval $(call BuildPackage,snapd))
