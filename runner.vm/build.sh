#!/bin/bash

#in MiB
DISK_SIZE=2048
ESP_SIZE=64

if [ -n "$TAR_FILENAME" ]; then
   case "$TAR_FILENAME" in
      rootfs.raw)
         dd bs=${ESP_SIZE}MiB seek=1 of=disk.raw conv=notrunc status=none;;
      *)
         cat > "$TAR_FILENAME";;
   esac
   exit 0
fi

rm disk.raw

truncate -s $(($ESP_SIZE - 2))MiB disk.raw
mformat -i disk.raw@@2M -F
truncate -s ${DISK_SIZE}MiB disk.raw
parted disk.raw -s mklabel gpt mkpart EFI 2MiB ${ESP_SIZE}MiB mkpart root ${ESP_SIZE}MiB 100% set 1 esp

DOCKER_BUILDKIT=1 docker build --no-cache -o - -q --build-arg ROOT_PART_SIZE=$(($DISK_SIZE - $ESP_SIZE - 1)) -f Dockerfile.root . | tar x --to-command="$BASH_SOURCE"

objcopy \
   --add-section .cmdline="cmdline.txt" --change-section-vma .cmdline=0x30000 \
   --add-section .linux="vmlinuz-linux" --change-section-vma .linux=0x40000 \
   --add-section .initrd="initramfs-linux.img" --change-section-vma .initrd=0x3000000 \
   linuxx64.efi.stub BOOTX64.EFI

mmd -i disk.raw@@2M ::/EFI
mmd -i disk.raw@@2M ::/EFI/BOOT
mcopy -i disk.raw@@2M BOOTX64.EFI ::/EFI/BOOT
