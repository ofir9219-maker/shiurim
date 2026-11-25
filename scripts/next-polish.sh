#!/bin/bash
# print next N queue entries not yet launched, and mark them launched
N=${1:-1}; cd /home/user/shiurim
awk 'NR==FNR{l[$1]=1;next} !($1 in l)' data/polish-launched.txt data/polish-queue.txt | head -$N | tee -a /dev/stderr | awk '{print $1}' >> data/polish-launched.txt
