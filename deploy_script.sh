#!/usr/bin/expect -f
set timeout 60
spawn scp -o StrictHostKeyChecking=no dist-improved.tar.gz root@137.184.12.217:/root/novastream/
expect "password:"
send "Wh1teNoise!@#\r"
expect eof
