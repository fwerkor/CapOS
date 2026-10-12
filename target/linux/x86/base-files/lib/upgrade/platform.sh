RAMFS_COPY_BIN='grub-bios-setup grub-editenv'

# Resolve the disk used to boot this system. ONIE uses a full GPT PARTUUID,
# which export_bootdevice does not resolve on all OpenWrt configurations.
onie_boot_diskseq() {
	local rootpart uevent diskseq
	rootpart=$(cmdline_get_var root)
	case "$rootpart" in
		PARTUUID=*)
			for uevent in /sys/class/block/*/uevent; do
				grep -Fiqx "PARTUUID=${rootpart#PARTUUID=}" "$uevent" 2>/dev/null || continue
				diskseq=$(sed -n 's/^DISKSEQ=//p' "$uevent")
				[ -n "$diskseq" ] && { echo "$diskseq"; return 0; }
			done
			;;
	esac
	export_bootdevice && [ -n "$BOOTDEV_DISKSEQ" ] || return 1
	echo "$BOOTDEV_DISKSEQ"
}

find_partname_dev() {
	local partname="$1" diskseq="$2"
	local uevent dev
	for uevent in /sys/class/block/*/uevent; do
		grep -Fxq "PARTNAME=$partname" "$uevent" 2>/dev/null || continue
		grep -Fxq "DISKSEQ=$diskseq" "$uevent" 2>/dev/null || continue
		dev=$(sed -n 's/^DEVNAME=//p' "$uevent")
		[ -n "$dev" ] && { echo "/dev/$dev"; return 0; }
	done
	return 1
}

# Only recognize ONIE partitions on the disk that booted this system.
is_onie_install() {
	local diskseq
	diskseq=$(onie_boot_diskseq) || return 1
	find_partname_dev ONIE-BOOT "$diskseq" >/dev/null &&
		find_partname_dev OPENWRT-ROOT "$diskseq" >/dev/null
}

# Reinstall via ONIE: append the preserved-config tarball to the installer
# image (installer detects it via size check), drop the combined file on
# OPENWRT-ROOT as onie-installer-x86_64, and flip both grubenv files so the
# next boot chainloads ONIE in install mode. ONIE re-runs our installer,
# which recreates OPENWRT-ROOT, extracts the new rootfs, and stashes
# /sysupgrade.tgz for OpenWrt's preinit to restore.
platform_do_upgrade_onie() {
	local image="$1"
	local backup="$UPGRADE_BACKUP"

	local diskseq root_dev onie_dev
	diskseq=$(onie_boot_diskseq) || {
		v "ONIE upgrade: unable to identify boot disk"; return 1;
	}
	root_dev=$(find_partname_dev OPENWRT-ROOT "$diskseq") || {
		v "ONIE upgrade: OPENWRT-ROOT not found"; return 1;
	}
	onie_dev=$(find_partname_dev ONIE-BOOT "$diskseq") || {
		v "ONIE upgrade: ONIE-BOOT not found"; return 1;
	}

	local root_mnt=/tmp/upgrade-root
	local onie_mnt=/tmp/upgrade-onie
	mkdir -p "$root_mnt" "$onie_mnt"

	mount -t ext4 -o rw,noatime "$root_dev" "$root_mnt" || {
		v "ONIE upgrade: mount $root_dev failed"
		return 1
	}

	local bundle="$root_mnt/onie-installer-x86_64"
	local staged="$bundle.tmp"
	v "ONIE upgrade: writing bundle to $bundle"
	if [ -s "$backup" ]; then
		if ! cat "$image" "$backup" > "$staged"; then
			v "ONIE upgrade: failed to stage installer bundle"
			rm -f "$staged"
			umount "$root_mnt"
			return 1
		fi
	else
		if ! cp "$image" "$staged"; then
			v "ONIE upgrade: failed to stage installer bundle"
			rm -f "$staged"
			umount "$root_mnt"
			return 1
		fi
	fi
	if ! chmod +x "$staged" || ! mv -f "$staged" "$bundle"; then
		v "ONIE upgrade: failed to finalize installer bundle"
		rm -f "$staged"
		umount "$root_mnt"
		return 1
	fi
	sync

	# One-shot: OpenWrt's grub.cfg reads next_entry and chainloads ONIE.
	grub-editenv "$root_mnt/boot/grub/grubenv" set next_entry=ONIE || {
		v "ONIE upgrade: failed to set next_entry in OPENWRT-ROOT grubenv"
		sync; umount "$root_mnt"
		return 1
	}
	sync
	umount "$root_mnt"

	mount -o rw,noatime "$onie_dev" "$onie_mnt" || {
		v "ONIE upgrade: mount $onie_dev failed"
		return 1
	}
	grub-editenv "$onie_mnt/grub/grubenv" set onie_mode=install || {
		v "ONIE upgrade: failed to set onie_mode in ONIE-BOOT grubenv"
		sync; umount "$onie_mnt"
		return 1
	}
	sync
	umount "$onie_mnt"

	v "ONIE upgrade: ready; stage2 will reboot"
	return 0
}

platform_check_image() {
	local diskdev partdev diff
	[ "$#" -gt 1 ] && return 1

	if is_onie_install; then
		[ "$(get_magic_word "$1")" = "2321" ] || {
			v "Invalid image: expected ONIE installer (shell script)"
			return 1
		}
		head -c 4096 "$1" | grep -q '^PAYLOAD_OFFSET=' || {
			v "Invalid image: no PAYLOAD_OFFSET header"
			return 1
		}
		return 0
	fi

	case "$(get_magic_word "$1")" in
		eb48|eb63) ;;
		*)
			v "Invalid image type"
			return 1
		;;
	esac

	export_bootdevice && export_partdevice diskdev 0 || {
		v "Unable to determine upgrade device"
		return 1
	}

	get_partitions "/dev/$diskdev" bootdisk

	v "Extract boot sector from the image"
	get_image_dd "$1" of=/tmp/image.bs count=63 bs=512b

	get_partitions /tmp/image.bs image

	#compare tables
	diff="$(grep -F -x -v -f /tmp/partmap.bootdisk /tmp/partmap.image)"

	rm -f /tmp/image.bs /tmp/partmap.bootdisk /tmp/partmap.image

	if [ -n "$diff" ]; then
		v "Partition layout has changed. Full image will be written."
		ask_bool 0 "Abort" && exit 1
		return 0
	fi
}

platform_copy_config() {
	local partdev parttype=ext4

	# ONIE upgrade bundles sysupgrade.tgz into the installer itself.
	is_onie_install && return 0

	if export_partdevice partdev 1; then
		part_magic_fat "/dev/$partdev" && parttype=vfat
		mount -t $parttype -o rw,noatime "/dev/$partdev" /mnt
		cp -af "$UPGRADE_BACKUP" "/mnt/$BACKUP_FILE"
		umount /mnt
	fi
}

platform_do_bootloader_upgrade() {
	local bootpart parttable=msdos
	local diskdev="$1"

	if export_partdevice bootpart 1; then
		mkdir -p /tmp/boot
		mount -o rw,noatime "/dev/$bootpart" /tmp/boot
		echo "(hd0) /dev/$diskdev" > /tmp/device.map
		part_magic_efi "/dev/$diskdev" && parttable=gpt

		v "Upgrading bootloader on /dev/$diskdev..."
		grub-bios-setup \
			-m "/tmp/device.map" \
			-d "/tmp/boot/boot/grub" \
			-r "hd0,${parttable}1" \
			"/dev/$diskdev"

		umount /tmp/boot
	fi
}

platform_do_upgrade() {
	local diskdev partdev diff

	if is_onie_install; then
		platform_do_upgrade_onie "$1"
		return $?
	fi

	export_bootdevice && export_partdevice diskdev 0 || {
		v "Unable to determine upgrade device"
		return 1
	}

	sync

	if [ "$UPGRADE_OPT_SAVE_PARTITIONS" = "1" ]; then
		get_partitions "/dev/$diskdev" bootdisk

		v "Extract boot sector from the image"
		get_image_dd "$1" of=/tmp/image.bs count=63 bs=512b

		get_partitions /tmp/image.bs image

		#compare tables
		diff="$(grep -F -x -v -f /tmp/partmap.bootdisk /tmp/partmap.image)"
	else
		diff=1
	fi

	if [ -n "$diff" ]; then
		get_image_dd "$1" of="/dev/$diskdev" bs=4096 conv=fsync

		# Separate removal and addtion is necessary; otherwise, partition 1
		# will be missing if it overlaps with the old partition 2
		partx -d - "/dev/$diskdev"
		partx -a - "/dev/$diskdev"

		return 0
	fi

	#iterate over each partition from the image and write it to the boot disk
	while read part start size; do
		if export_partdevice partdev $part; then
			v "Writing image to /dev/$partdev..."
			get_image_dd "$1" of="/dev/$partdev" ibs=512 obs=1M skip="$start" count="$size" conv=fsync
		else
			v "Unable to find partition $part device, skipped."
		fi
	done < /tmp/partmap.image

	v "Writing new UUID to /dev/$diskdev..."
	get_image_dd "$1" of="/dev/$diskdev" bs=1 skip=440 count=4 seek=440 conv=fsync

	platform_do_bootloader_upgrade "$diskdev"
	local parttype=ext4
	part_magic_efi "/dev/$diskdev" || return 0

	if export_partdevice partdev 1; then
		part_magic_fat "/dev/$partdev" && parttype=vfat
		mount -t $parttype -o rw,noatime "/dev/$partdev" /mnt
		set -- $(dd if="/dev/$diskdev" bs=1 skip=1168 count=16 2>/dev/null | hexdump -v -e '8/1 "%02x "" "2/1 "%02x""-"6/1 "%02x"')
		sed -i "s/\(PARTUUID=\)[a-f0-9-]\+/\1$4$3$2$1-$6$5-$8$7-$9/ig" /mnt/boot/grub/grub.cfg
		umount /mnt
	fi
}
