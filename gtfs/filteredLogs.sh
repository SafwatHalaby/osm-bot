# A script for supressing uninteresting logs.
# Put non interesting logs in suppress.txt
# Put the latest logs in latest.txt

cd ../../gtfs/logs/
latest=$(<latest.txt)
latest=`echo "$latest" | sort`

suppress=$(<suppress.txt)
suppress=`echo "$suppress" | sort`

# Only print lines that are in latest.txt but not in suppress.txt
comm -23 <(echo "$latest") <(echo "$suppress")

# Remove lines that are only in supress.txt from suppress.txt
comm -12 <(echo "$latest") <(echo "$suppress") > suppress.txt
