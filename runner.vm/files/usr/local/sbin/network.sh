#!/bin/bash

set -euo pipefail

get_metadata () {
  curl -s -L -f --retry 5 --retry-connrefused -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/$1
}

# from https://forums.gentoo.org/viewtopic-t-888736-start-0.html
mask2cdr () {
   # Assumes there's no "255." after a non-255 byte in the mask
   local x=${1##*255.}
   set -- 0^^^128^192^224^240^248^252^254^ $(( (${#1} - ${#x})*2 )) ${x%%.*}
   x=${1%%$3*}
   echo $(( $2 + (${#x}/4) ))
}

sysctl -q -w net.ipv6.conf.eth0.disable_ipv6=1
ip addr add 169.254.0.0/16 dev eth0
ip link set eth0 up

tries=100
until eval '(( $(< /sys/class/net/eth0/carrier) ))'; do
   (( tries-- > 0 )) || exit 1
   sleep 0.1
done

echo $(get_metadata name) > /proc/sys/kernel/hostname

IP=$(get_metadata network-interfaces/0/ip)
GW=$(get_metadata network-interfaces/0/gateway)
MASK=$(get_metadata network-interfaces/0/subnetmask)

echo nameserver $(get_metadata network-interfaces/0/dns-servers) > /etc/resolv.conf
ip addr add ${IP}/$(mask2cdr ${MASK}) dev eth0
ip route add default via ${GW}