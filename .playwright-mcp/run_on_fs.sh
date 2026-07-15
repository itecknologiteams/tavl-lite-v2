#!/bin/bash
# Runs ON prod (.156). Pushes a job script to FreeSWITCH (.140) and runs it with sudo.
# Usage: run_on_fs.sh <FS_SSH_PASSWORD> <local_job_script_path_on_prod>
set -e
FS_PASS="$1"
JOB="$2"
FS=iteckadmin@192.168.20.140
sshpass -p "$FS_PASS" scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$JOB" "$FS:/tmp/_fsjob.sh" >/dev/null
sshpass -p "$FS_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$FS" "echo '$FS_PASS' | sudo -S bash /tmp/_fsjob.sh"
