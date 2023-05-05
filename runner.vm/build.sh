#!/bin/bash

#in MiB
DISK_SIZE=2048
ESP_SIZE=64

if [ -n "$TAR_FILENAME" ]; then
   case "$TAR_FILENAME" in
      rootfs.raw)
         dd bs=${ESP_SIZE}MiB seek=1 of=disk.raw conv=notrunc status=none;;
      arch.efi)
         mcopy -i disk.raw@@2M - ::/EFI/BOOT/BOOTX64.EFI;;
      *)
         echo "Unexpected file in output: $TAR_FILENAME" && exit 1;;
   esac
   exit 0
fi

[ -f disk.raw ] && echo "disk.raw already exists; need to remove before running script" && exit 1

truncate -s $(($ESP_SIZE - 2))MiB disk.raw
mformat -i disk.raw@@2M -F
mmd -i disk.raw@@2M ::/EFI
mmd -i disk.raw@@2M ::/EFI/BOOT
truncate -s ${DISK_SIZE}MiB disk.raw
parted disk.raw -s mklabel gpt mkpart EFI 2MiB ${ESP_SIZE}MiB mkpart root ${ESP_SIZE}MiB 100% set 1 esp

DOCKER_BUILDKIT=1 docker build --no-cache -o - -q --build-arg ROOT_PART_SIZE=$(($DISK_SIZE - $ESP_SIZE - 1)) -f Dockerfile.root . | tar x --to-command="$BASH_SOURCE"

