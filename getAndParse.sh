cd /home/osm/openStreetMap/gtfs

mv old old_backup
mv new old
mkdir new

# At this point, "old/" and "old_backup/" are folders that have:
# - "stops.txt" (original DB)
# - "parsed.txt" (parsed DB)
# - "date.txt" (download date 
# "new" is an empty folder
# stops.txt contains lines that are as follows
# stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,location_type,parent_station,zone_id

./download.sh # downloads a new stops.txt from the mot site

mv stops.txt new/ # put the new stops.txt in "new"
cd new/
cat stops.txt | tail --lines=+2 | cut -d "," -f 2-6 | sort > parsed.txt
# 1. cut the header (not a bus station)
# 2. Only keep columns 2-6 (stop_code,stop_name,stop_desc,stop_lat,stop_lon)
# 3. sort by ref (probably no longer needed)

date > date.txt # save date of download. Only used by humans if needed. Software doesn't need it.
cd ..

# The trick below is no longer relevant. Entire dataset is needed.
# save time and processing power by only parsing whatever lines are different between the two files
# requires the files to be sorted
# comm -13 old/parsed.txt new/parsed.txt > new_delta.txt 
# comm -23 old/parsed.txt new/parsed.txt > old_delta.txt 
