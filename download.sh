#!/usr/bin/expect

set timeout 30
spawn ftp -p gtfs.mot.gov.il
expect "Name"
send "anonymous\r"
expect "Password:"
send "\r"
expect "ftp> "
send "binary\r"
set timeout 1000
send "get israel-public-transportation.zip\r"
expect "226"
send "bye\r"
