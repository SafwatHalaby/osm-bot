The following collection of files is used for incrementally updating
OpensStreetMap bus stops by using GTFS files as input. Each script is
explained below. All JS scripts are meant to run with the JOSM scripting
plugin. getAndParse.sh is a Unix shell script.

An overview and a description of the algorithm can be found here:
https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/gtfs

spaces.js is written in a generic way, and you can use it for spacial
tasks that are completely unrelated to gtfs. This includes merging
duplicate nodes, or comparing OSM elements with nearby elements.

Scripts explanation:
gtfs.js: The main script. Takes 2 gtfs files as input and updates an
         OSM dataset.
getAndParse.sh: Downloads newer gtfs files, and parses them in 
                preparation for consumption by gtfs.js
space.js: A helper script, which removes duplicate bus stops and flags
          suspect duplicates. It can be modified to perform other spacial
          tasks unrelated to GTFS. Should be run after gtfs.js.
gtfs_bootstrap.js: Can derive a gtfs file from an OSM dataset.
                   If someone else imported bus stops to your country years
                   ago, and the file used for import is lost, this can
                   be used to recreate it, allowing gtfs.js to work properly.
                   Alternatively, gtfs.js can be bootstrapped with a blank
                   old/parsed.txt.
