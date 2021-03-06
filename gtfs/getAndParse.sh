DATA_DIR=/home/osm/openStreetMap/gtfs
NO_DOWNLOAD=0 # if 1, israel-public-transportation.zip is not downloaded
# and the script will run even if israel-public-transportation.zip is not modified.

# Downloads updated gtfs data from the mot site and parses it, setting the
# stage for gtfs.js to compare old/parsed.txt and new/parsed.txt, which
# then incrementally updates the bus stops in Israel.
# See: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/gtfs

# "old/" and "new/" are folders that have:
# - "parsed.txt" (parsed DB)
# - "translations.txt" (mapping of text to Hebrew, Arabic, and English)
# - "date.txt" (download date)

createBackup()
{
	if [ ! -d backups ]; then mkdir backups; fi
	BACKUP_DIR=backups/`cat new/date.txt`
	if [ ! -d "$BACKUP_DIR" ]; then
		mkdir "$BACKUP_DIR"
		mkdir "$BACKUP_DIR"/new 
		mkdir "$BACKUP_DIR"/old
		ln new/* "$BACKUP_DIR"/new/ # hard link
		ln old/* "$BACKUP_DIR"/old/ # hard link
	fi
	# The shallow copy (hard link) allows us to avoid file redundancies.
}

cd "$DATA_DIR"
if [ -d new ] && [ -d old ]; then
	# --- "new/" exists, "old/" exists ---
	# First, we create a backup of the existing files if no backup exists already
	createBackup
elif [ -d old ]; then
	# --- "new/" does not exist, "old/" exists ---
	echo "Error: An \"old\" folder exists but a \"new\" folder is not present" >&2
	exit 1
elif [ ! -d new ]; then
	# --- "new/" does not exist, "old/" does not exist ---
	# We have neither "new/" nor "old/", bootstrap with a blank "new/",
	# which will be immediately moved to "old/" below.
	mkdir new
	touch new/parsed.txt new/translations.txt
	echo "N/A (blank bootstrap)" > new/date.txt
fi
# if "new/" exists and "old/" does not exist, we do nothing special 
# and none of the blocks above are entered

if [ "$NO_DOWNLOAD" = "0" ]; then
	lastModified=`stat -c "%y" israel-public-transportation.zip` 2> /dev/null || lastModified="N/A"
	wget --timestamping ftp://gtfs.mot.gov.il/israel-public-transportation.zip || exit 2
	lastModified2=`stat -c "%y" israel-public-transportation.zip`
	
	if [ "$lastModified" =  "$lastModified2" ]; then
		echo "Bus stops not modified. Script exiting"
		exit 0
	fi
fi

if [ -d old ]; then rm -fr old; fi
mv new old
mkdir new

# stops.txt contains the following comma-separated fields:
# stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,location_type,parent_station,zone_id
unzip -p israel-public-transportation.zip stops.txt | tail --lines=+2 | cut -d "," -f 2-6 | sort > new/parsed.txt
# 1. Remove the header (not a bus station)
# 2. Keep only columns 2-6 (stop_code,stop_name,stop_desc,stop_lat,stop_lon)
# 3. Sort by stop_code (probably no longer needed)

# translations.txt contains the following comma-separated fields:
# trans_id,lang,translation
# trans_id is simply the hebrew name, lang is a two-letter language code.
unzip -p israel-public-transportation.zip translations.txt | tail --lines=+2 > new/translations.txt
# cut the header (not a translation)

# date output example: "2017-11-08_0910_Wed" means "Wed Nov 8 09:10 2017"
date +%F_%H%M%S_%a > new/date.txt # save date of download. Used by backups, and by humans if manual file inspection is needed.
createBackup
