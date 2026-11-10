#!/bin/sh
while [ ! -f /tmp/codex44-stop ]; do
  printf '%s ' "$(date +%s)"
  for f in memory.current memory.peak pids.current memory.swap.current; do printf '%s ' "$(cat /sys/fs/cgroup/$f)"; done
  awk '$1=="anon" || $1=="file" || $1=="shmem" || $1=="inactive_file" {printf "%s=%s ",$1,$2} END {print ""}' /sys/fs/cgroup/memory.stat
  sleep 0.2
done
cat /sys/fs/cgroup/memory.events
