cd /home/osm/openStreetMap/gtfs

# Downloads updated gtfs data from the mot site and parses it, setting the
# stage for gtfs.js to compare old/parsed.txt and new/parsed.txt, which
# then incrementally updates the bus stops in Israel.
# See: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/gtfs

mv old old_backup
mv new old
mkdir new

# At this point, "old/" and "old_backup/" are folders that have:
# - "parsed.txt" (parsed DB)
# - "translations.txt" (mapping of text to Hebrew, Arabic, and English)
# - "date.txt" (download date)

wget --timestamping ftp://gtfs.mot.gov.il/israel-public-transportation.zip
cd new/
unzip -p ../israel-public-transportation.zip stops.txt | tail --lines=+2 | cut -d "," -f 2-6 | sort > parsed.txt
# stops.txt contains the following comma-separated fields:
# stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,location_type,parent_station,zone_id
# 1. Remove the header (not a bus station)
# 2. Keep only columns 2-6 (stop_code,stop_name,stop_desc,stop_lat,stop_lon)
# 3. Sort by stop_code (probably no longer needed)
unzip -p ../israel-public-transportation.zip translations.txt | tail --lines=+2 > translations.txt
# cut the header (not a translation)

date > date.txt # save date of download. Only used by humans if needed. Software doesn't need it.
cd ..
