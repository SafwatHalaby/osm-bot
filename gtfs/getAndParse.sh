cd /home/osm/openStreetMap/gtfs

# Grabs a new stops.txt from the mot site and parses it, setting the
# stage for gtfs.js to compare old/parsed.txt and new/parsed.txt, which
# then incrementally update the bus stops in Israel.
# See: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/gtfs

mv old old_backup
mv new old
mkdir new

# At this point, "old/" and "old_backup/" are folders that have:
# - "stops.txt" (original DB)
# - "parsed.txt" (parsed DB)
# - "date.txt" (download date)
# stops.txt contains lines that are as follows
# stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,location_type,parent_station,zone_id

wget --timestamping ftp://gtfs.mot.gov.il/israel-public-transportation.zip
unzip israel-public-transportation.zip stops.txt translations.txt
cd new/
cat ../stops.txt | tail --lines=+2 | cut -d "," -f 2-6 | sort > parsed.txt
# 1. cut the header (not a bus station)
# 2. Only keep columns 2-6 (stop_code,stop_name,stop_desc,stop_lat,stop_lon)
# 3. sort by ref (probably no longer needed)
cat ../translations.txt | tail --lines=+2 > translations.txt
# cut the header (not a translation)
rm ../translations.txt ../stops.txt

date > date.txt # save date of download. Only used by humans if needed. Software doesn't need it.
cd ..
