(function(){

/* A human mapper is allowed to:
 1. Remove a stop entirely. The bot will only re-add it if MOT changes it afterwards.
 2. Modify any tag which is not in gOverrideList or gAlwaysAdd.

There are several kinds of tags.

gOverrideList:   Tags that the bot will always override and users shouldn't edit.
gMostRecentList: The bot respects the most recent change for these tags, be it a GTFS change or an OSM user change.
gAlwaysAdd:      The bot always adds these constant keys and values.
others:          The bot never modifies any tags which aren't in any of the lists above.
*/
STREET_TAG = "addr:street";
ADDR_TAG = "gtfs:addr:housenumber";
var gOverrideList = [ADDR_TAG, "ref", "description"]; // Also implicitly: name, name:ar, name:he, name:en. These are outside the array because they require special treatment.
var gMostRecentList = [STREET_TAG, "level"];  // Also implicitly: lat, lon. These are outside the array because they require special treatment.
var gAlwaysAdd = [{key: "source", value: "israel_gtfs"}, {key: "public_transport", value: "platform"}, {key: "bus", value: "yes"}];

/* Special tags
 - source=israel_gtfs:     The bot relies on this for certain warnings and in the stop deletion logic. Stops without this are never auto deleted but may emit warnings.
 - source=israel_gtfs_v1:  Older scheme. The bot modifies it to israel_gtfs whenever found.
 - gtfs:verified=*:        Older scheme. The bot will always delete this. */

var print = require("josm/util").println;
var builder= require("josm/builder");
var command = require("josm/command");
var FATAL = false; // If true, fatal error. Abort.

var VERBOSE_MODE = true;          // set to true to print a line "???_" line for every stop where "?" is d or x, except for XXX_update. 
var PRINT_CREATE_DELETE = true;   // set to true to print all creations/deletions. Implicitly true if verbose mode is true.
var PRINT_XXX = false;            // Print xxx_update. Extremely verbose on incremental updates
var PRINT_UPDATED_TAGS = true;    // Print the precise tags that have changed for updated stops.
var PRINT_SPACIAL_THRESHOLD = 20; // Print spacial desyncs only if they are larger than this. Overridden positions (<SNAP_THRESHOLD) are always printed anyways.
var SNAP_THRESHOLD = 3;           // Override position for stops moved less than this. This is because tiny movements are usually a mapper mistake.
var DELETE_DEBUG = false;         // Set to true to tag with "DELETE_DEBUG=DELETE_DEBUG" rather than delete nodes.
var DB_DIR = "/home/osm/openStreetMap/gtfs/"; // The directory where the old and new gtfs files are present.
// Desync messages are always printed

/* Script page and documentation: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/gtfs
Last update: 07 May 2018
major version: 2

Typical Overpass query:
 
[out:xml][timeout:90][bbox:29.4013195,33.8818359,33.4131022,36.0791016];
(
area(3601473946); // Israel
area(3601803010); // Judea and Samaria
)->.a;
(
  node["highway"="bus_stop"](area.a);
  way["highway"="bus_stop"](area.a);
)->.b;
(rel(bw.b);rel(bn.b);)->.routes;
(.b;way(bn.b);)->.b;
(.b;node(w.b);)->.b;
(.b;.routes;);
out meta;
*/

////////////////////////////// File functions

function readFile_forEach(path, forEach)
{
	var File = java.io.File;
	var BufferedReader = java.io.BufferedReader;
	var FileReader = java.io.FileReader;
	var file = new File(path);
	var br = new BufferedReader(new FileReader(file));
	var line;
	while ((line = br.readLine()) != null)
	{
	  forEach(line);
	}
	br.close();
}

var trainStationTempCnt = 0;
/** Reads a line from the GTFS files and returns a Javascript gtfs entry. */
function lineToGtfsEntry(line)
{
	if (line.indexOf("רחוב:מסילת ברזל  עיר") !== -1) {trainStationTempCnt++; return null;}  // temporary hack to ignore train stations
	if (line.trim() === "") return null; //whitespace-only line
	var arr = line.split(",");
	var gtfsEntry = {};
	gtfsEntry["ref"] = cleanupString(arr[0]);         // stop_code
	gtfsEntry["name:he"] = cleanupString(arr[1]);     // stop_name (he)
	gtfsEntry["lat"] = Number(cleanupString(arr[3])); // stop_lat
	gtfsEntry["lon"] = Number(cleanupString(arr[4])); // stop_lon
	var descriptionData = parseDescription(arr[2], gtfsEntry["ref"]); // returns an associative array. See function comments.
	if (descriptionData["רחוב"] !== undefined)
	{
		var streetAndNumber = descriptionData["רחוב"];
		delete descriptionData["רחוב"];
		if (streetAndNumber.indexOf("/") == -1) // Stops on an intersection sometimes have to streets seperated with a /. Ignore those values.
		{
			var rgx = streetAndNumber.match(/^(.*?) ([0-9]+)$/);
			var street;
			var number;
			if (rgx != null)
			{
				// 0 is for the entire match.
				gtfsEntry[STREET_TAG] = rgx[1];
				gtfsEntry[ADDR_TAG] = rgx[2];
			}
			else
			{
				gtfsEntry[STREET_TAG] = streetAndNumber;
			}
		}
	}
	if (descriptionData["קומה"] !== undefined)
	{
		gtfsEntry["level"] = descriptionData["קומה"];
		delete descriptionData["קומה"];
	}
	
	// Any descriptionData leftovers are put into the description tag.
	var first = true;
	var description = "";
	for (key in descriptionData)
	{
		if (descriptionData.hasOwnProperty(key))
		{
			if (first) first = false;
			else description += ", ";
			description += key + ": " + descriptionData[key];
		}
	}
	if (description !== "")
	{
		gtfsEntry["description"] = description;
	}
	return gtfsEntry;
}

function cleanupString(str)
{
	return str.replace(/\s+/g, ' ').trim();
}

/** MOT currently uses a key1:val1 key2:val2 format in the description.
val might have spaces or might be blank.
1. parses the description
2. ignores keys whose value is blank
3. returns an associative array of key-value pairs. */
function parseDescription(description)
{
	var result = {};
	var keysAndValues = description.replace('\s+', ' ').split(/([^\s\:]+\:)/g);
	var currentKey;
	for (var i = 0; i < keysAndValues.length; i++)
	{
		var current = keysAndValues[i].trim();
		if (current == "") continue;
		if (current.search(":") != -1) // key found
		{
			currentKey = current.replace(":", "").trim();
			if (currentKey == "עיר") currentKey = "";
			if (currentKey == "") continue;
			//print("Found key:" + currentKey);
		}
		else // lookingFor = VAL
		{
			if (currentKey == "") continue;
			var currentVal = current.trim();
			if (currentVal == "") continue;
			// print("Found val. key:" + currentKey, ", val:" + currentVal);
			result[currentKey] = currentVal;
			currentKey = "";
		}
	}
	
	return result;
}




////////////////////////////// Small helper functions

function printV(str)
{
	if (VERBOSE_MODE === true) print(str);
}

function printCD(str)
{
	if ((VERBOSE_MODE === true) || (PRINT_CREATE_DELETE === true)) print(str);
}

function del(p, layer)
{
	if (!DELETE_DEBUG)
		layer.apply(command.delete(p));
	else
		p.tags["DELETE_DEBUG"] = "DELETE_DEBUG";
}

// Source https://stackoverflow.com/questions/27928/calculate-distance-between-two-latitude-longitude-points-haversine-formula
function getDistanceFromLatLonInM(lat1,lon1,lat2,lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2-lat1);  // deg2rad below
  var dLon = deg2rad(lon2-lon1); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var d = R * c; // Distance in km
  return d * 1000;
}

function deg2rad(deg) {
  return deg * (Math.PI/180)
}

/** Rhino/JOSM script plugin doesn't seem to have pretty printing for debugging
 This is a simple alternative, similar to console.log(object). */
function printObj(obj,indent)
{
	if (indent === undefined) indent = "";
	else indent = indent + " ";
	
	if (obj instanceof Array)
	{
		print(indent+"[");
		for (var i = 0; i < obj.length; ++i)
			printObj(obj[i], indent);
		print(indent+"]");
	}
	else if (obj instanceof Object)
	{
		print(indent+"(");
		for (var key in obj)
		{
			if (obj.hasOwnProperty(key)) 
			{
				print(indent+key+": ");
				printObj(obj[key], indent);
			}
		}
		print(indent+")");
	}
	else // POD
	{
		print(indent+obj);
	}
}

////////////////////////////// Stats




var gStats = {
	ddx_del: 0, ddx_nothing: 0, dxd_create: 0, dxx_update: 0, xdd_nothing: 0, xdx_delete: 0, xxd_create: 0, xxd_nothing: 0, xxx_update: 0,
	update: 0,                        /* Total updates (update_touched + update_not_touched) */
	update_touched: 0                 /* Total updates that actually changed something */,
	update_not_touched: 0,            /* Total bus stop update attempts that didn't need to change any tags */
	update_spacialDesync_snap: 0,     /* Total updates that were skipped because the position changed significantly */
	update_spacialDesync_ignore: 0,   /* Total updates that were done despite the position changing significantly */
	create: 0,                        /* Total created stops (dxd_create+xxd_create) */
	del: 0,                           /* Total deleted stops (ddx_del+xdx_delete) */
	nothing: 0,                       /* Total stops where no action was taken (xdd_nothing+ddx_nothing+xxd_nothing) */
	touched: 0,                       /* create + del + update_touched */
	total_newGTFS: 0,                 /* total bus stop lines in the new GTFS file. */
	total_oldGTFS: 0,                 /* total bus stop lines in the old GTFS file */
	total_OsmBeforeRun: 0,            /* Total "ref" carrying stops in Israel, prior to the run */
	total_OsmAfterRun: 0,             /* Total "ref" carrying stops in Israel, after the run (total_OsmBeforeRun+created-deleted) */ 
	nonMOT_arabic_name: 0             /* Total non MOT provided names in the "name" tag. */
	//note: total_OsmAfterRun = total_newGTFS + ddx_nothing (ref carrying stops that aren't from gtfs DB)
}



////////////////////////////// MAIN

function main()
{
	print("");
	print("### Running script");
	var layer = josm.layers.get(0); // java will stop us if no dataset present
	var ds = layer.data;
	
	var gtfs = {}; // Contains "stop" objects that look like this: {newEntry: <obj>, oldEntry: <obj>, osmElement: <obj>}
	// Where newEntry is grabbed from the new GTFS, old from the old one, and osmElement from the dataset.
	// newEntry and oldEntry are both assosiative arrays of the key/val pairs. lat/lon are also stored in that same array.
	
	// Read lines from the new gtfs, and fill "gtfs[ref].newEntry"
	{
		var translations_new = main_fillTranslations(DB_DIR+"/new/translations.txt"); // sets FATAL if unknown language detected
		main_fillNewGtfs(gtfs, DB_DIR+"/new/parsed.txt", translations_new); // sets FATAL if some bus stops have the same ref.
	}
	
	// Read lines from the old gtfs, and fill "gtfs[ref].oldEntry"
	{
		var translations_old = main_fillTranslations(DB_DIR+"/old/translations.txt"); // sets FATAL if unknown language detected
		main_fillOldGtfs(gtfs, DB_DIR+"/old/parsed.txt", translations_old); // sets FATAL if some bus stops have the same ref.
	}
	
	// ref -> osmElement dictionary, will be used below to fill "gtfs[ref].osmElement"
	var osm_ref = main_initOsmRef(ds); // sets FATAL if some bus stops have the same ref.
	
	if (FATAL)
	{
		print("### Script canceled");
		return;
	}
	
	// Iterate all "gtfs" objects, decide what to do with each. 
	for (var ref in gtfs)
	{
		if (gtfs.hasOwnProperty(ref)) 
		{
			var stop = gtfs[ref]; 
			// stop = {newEntry: <obj or null>, oldEntry: <obj or null>, osmElement: null (or filled below)}
			
			// - - -  => N/A
			if ((stop.oldEntry === null) && (stop.newEntry === null))
			{
				print("FATAL. this should never happen");
				return;
			}
			
			// Fill stop.osmElement. The element returned is also removed from osm_ref
			// May return null
			var match = matchGtfEntryToAnOsmElement(osm_ref, stop); 
			stop.osmElement = match;
			
			// ? ? -
			if (match == null)
			{
				if ((stop.oldEntry === null) && (stop.newEntry !== null))
				{
					printCD("-X-: " + ref + ". Created.");
					gStats.dxd_create++;
					busStopCreate(stop, ds);
				}
				// X - -
				if ((stop.oldEntry !== null) && (stop.newEntry === null))
				{
					printV("X--: " + ref + ". NoAction.");
					gStats.xdd_nothing++;
					gStats.nothing++;
				}
				// X X -
				if ((stop.oldEntry !== null) && (stop.newEntry !== null))
				{
					if (shouldRecreateXXD(stop))
					{
						printCD("XX-: " + ref + ". Created.");
						gStats.xxd_create++;
						busStopCreate(stop, ds);
					}
					else
					{
						// XX- NoAction
						print("DESYNC: " + ref + " Stop exists in GTFS but deleted by user.");
						gStats.xxd_nothing++;	
						gStats.nothing++;
					}
				}
			}
			// ? ? X
			else
			{	
				if ((stop.oldEntry === null) && (stop.newEntry !== null))
				{
					printV("-XX: " + ref + ". Updated. osmId=" + match.id);
					gStats.dxx_update++;
					busStopUpdate(stop);
				}
				if ((stop.oldEntry !== null) && (stop.newEntry === null))
				{
					printCD("X-X: " + ref + ". Deleted. osmId=" + match.id);
					gStats.xdx_delete++;
					busStopDelete(stop, layer);
				}
				if ((stop.oldEntry !== null) && (stop.newEntry !== null))
				{
					if (PRINT_XXX)
						print("XXX: " + ref + ". Updated. osmId=" + match.id); // uncomment if you wanna get SUPER verbose
					gStats.xxx_update++;
					busStopUpdate(stop);
				}
			}
		}
	}

	// Whatever is left in osm_ref is // - - X
	for (var ref in osm_ref)
	{
		if (osm_ref.hasOwnProperty(ref))
		{
			var el = osm_ref[ref];
			if ((el.tags["source"] === "israel_gtfs") || (el.tags["source"] === "israel_gtfs_v1"))
			{
				gStats.ddx_del++;
				print("--X: " + ref + ". Deleted. Has source=gtfs. osmId=" + el.id);	
				busStopDelete({osmElement: el}, layer);
			}
			else
			{
				// --X: NoAction
				print("DESYNC: " + ref + " Stop only in OSM and no source=gtfs. osmId=" + el.id);
				gStats.ddx_nothing++;
				gStats.nothing++;
			}
		}
	}
	
	// print stats
	for (var stat in gStats)
	{
		if (gStats.hasOwnProperty(stat))
		{
			print(stat + ": " + gStats[stat]);
		}
	}
	print("Ignored train stops: " + trainStationTempCnt);

	// sanity checks on the stats
	performSanityChecks();

	print("### Script finished");
}

////////////////////////////// MAIN helpers. Initializiation functions called only once.

function main_initOsmRef(ds)
{
	var osm_ref = {};
	ds.each(function(p)
	{
			if (p.tags["highway"] !== "bus_stop") return;
			var ref = p.tags["ref"];
			if (ref === undefined) return;
			gStats.total_OsmBeforeRun++;
			if (osm_ref[ref] === undefined)
			{
				osm_ref[ref] = p;
			}
			else
			{
				FATAL = true;
				print("FATAL: multiple bus stops with ref " + ref);
				return null;
			}			
	});
	gStats.total_OsmAfterRun = gStats.total_OsmBeforeRun;
	return osm_ref;
}

function main_fillTranslations(file)
{
	var translationObject = {en : {}, ar: {}};
	readFile_forEach(file, function(javaLine)
	{
		var line = javaLine + "";
		var arr = line.replace(/\s+/g, ' ').split(",");
		var original = arr[0].trim();
		var language = arr[1].toLowerCase().trim();
		if (language == "he") return;
		var translation = arr[2].trim();
		if (translationObject[language] === undefined) {FATAL = true; print("Unexpected translation language: " + language);return;}
		translationObject[language][original] = translation;
	});
	return translationObject;
}

function main_fillNewGtfs(gtfs, path, translations)
{
	readFile_forEach(path, function(javaLine)
	{
		var line = javaLine+"";
		var newE = lineToGtfsEntry(line);
		if (newE === null) return;
		var ref = newE["ref"];
		if (gtfs[ref] !== undefined)
		{
			return; // todo handle platforms
			print("FATAL: Two gtfs entries with same ref in new db: " + ref);
			FATAL = true;
		}
		gStats.total_newGTFS++;
		gtfs[ref] = {newEntry: newE, oldEntry: null, osmElement: null};
		newE["name:en"] = translations["en"][newE["name:he"]]; // could be undefined
		newE["name:ar"] = translations["ar"][newE["name:he"]]; // could be undefined
	});
}

function main_fillOldGtfs(gtfs, path, translations)
{
	readFile_forEach(path, function(javaLine)
	{
		var line = javaLine+"";
		var oldE = lineToGtfsEntry(line);
		if (oldE === null) return;
		var ref = oldE["ref"];
		if (gtfs[ref] === undefined)
		{
				gtfs[ref] = {newEntry: null, oldEntry: null, osmElement: null};
		}
		if (gtfs[ref].oldEntry !== null)
		{
			return; // todo handle platforms
			print("FATAL: Two gtfs entries with same ref in old db: " + ref);
			FATAL = true;
		}
		gStats.total_oldGTFS++;
		gtfs[ref].oldEntry = oldE;
		oldE["name:en"] = translations["en"][oldE["name:he"]]; // could be undefined
		oldE["name:ar"] = translations["ar"][oldE["name:he"]]; // could be undefined
	});
}
	


////////////////////////////// gtfs and osm functions



function matchGtfEntryToAnOsmElement(osm_ref, stop)
{
		var entry = (stop.newEntry === null ? stop.oldEntry : stop.newEntry);
		var ref = entry["ref"];
		var matchingOsmElement = osm_ref[ref];
		if (matchingOsmElement === undefined)
		{
			return null;
		}
		else
		{
			delete osm_ref[ref];
			return matchingOsmElement;
		}
}

/** Only touch the tags that:
1. have been either changed between theold gtfs and the new gtfs
2. don't exist in the old gtfs
3. for a created stop *

Suitable tags are set to the new gtfs file value. */
function setIfNotSetAndChanged(key, stop, isCreated)
{

	if (isCreated || (stop.oldEntry === null) || (stop.oldEntry[key] !== stop.newEntry[key]))
	{
		return setRaw(stop.osmElement, key, stop.newEntry[key]);
	}

	// reaching here implies: stop.oldEntry = stop.newEntry and it is not null.
	// Meaning the data value has not changed since last run.
	// Also, the node is not a created node. It's already on the map.	.
	
	var gtfsValue = stop.newEntry[key]; // same as gtfsValue = stop.oldEntry[key];
	var mapValue = stop.osmElement.tags[key];
	if (gtfsValue !== mapValue)
	{
		// User value is different from GTFS value
		// We honor the user value, but log this anyways
		
		// Do not log cases where the gtfs Hebrew equals "name" and "name:he" is not present.
		if ((key == "name:he") && (gtfsValue === stop.osmElement.tags["name"]) && (mapValue == undefined)) return false;
		
		// XXX - NoAction
		print("DESYNC: " + stop.osmElement.tags.ref + " Value desync." + 
		" key=" + key +
		", gtfsVal=" + gtfsValue + 
		", osmVal=" + mapValue +
		", osmId=" + stop.osmElement.id);
	}
	// Else, the user value also equals the GTFS value. Nothing needs to be done.
	return false;
}

/** set the tag of an osm element, regardless of gtfs files. */
function setRaw(osmElement, key, value)
{
	if (osmElement.tags[key] !== value)
	{
		if ((value !== undefined) && (value !== "") && (value !== null))
		{
			osmElement.tags[key] = value;
			return true;
		}
		else if (osmElement.tags[key] !== undefined)
		{
			osmElement.removeTag(key);
			return true;
		}
	}
	return false;
}

/** The "stop" exists in the old and the new gtfs files
but doesn't exist in OSM, meaning a user deleted it
If it hasn't changed since then, we shouldn't recreate it and we return false.
Otherwise, we should, so we return true. (We always trust the most recent change) */
function shouldRecreateXXD(stop)
{

	
	for (var key in stop.oldEntry)
	{
		if (stop.oldEntry.hasOwnProperty(key))
		{
			if (stop.oldEntry[key] !== stop.newEntry[key]) return true;
		}
	}
	return false;
}

function busStopUpdate(stop, isCreated)
{
	
	function printTagUpdate(str, key, oldVal, val)
	{
		if (shouldPrintUpdates)
			print("TAG-UPDATE " + str + ": " + stop.osmElement.tags["ref"] + ". key=" + key + ", oldVal=" + oldVal + ", newVal=" + val);
	}
	
	if (isCreated === undefined)
	{
		isCreated = false;
		gStats.update++;
	}
	var shouldPrintUpdates = (!isCreated) && (PRINT_UPDATED_TAGS);

	var touched = false;
	
	// calls "setRaw" and also turns touched to true if anything actually changed
	function setRawAndTouched(osmElement, key, value)
	{
		var hasTouched = setRaw(osmElement, key, value);
		touched = hasTouched || touched;
		return hasTouched;
	}
	
	// Handle the "override" list
	for (var i = 0; i < gOverrideList.length; i++)
	{
		var key = gOverrideList[i];
		var val = stop.newEntry[key];
		var oldVal = stop.osmElement.tags[key];
		if (setRawAndTouched(stop.osmElement, key, val))
		{
			printTagUpdate("override", key, oldVal, val);
		}
	}
	
	// Handle the "most recent" list
	for (var i = 0; i < gMostRecentList.length; i++)
	{
		var key = gMostRecentList[i];
		var oldVal = stop.osmElement.tags[key];
		var hasTouched = setIfNotSetAndChanged(key, stop, isCreated);
		touched = hasTouched || touched;
		if (hasTouched)
		{
			var val = stop.osmElement.tags[key];
			printTagUpdate("mostRecent", key, oldVal, val);
		}
	}
	
	// Handle the "always add" list
	for (var i = 0; i < gAlwaysAdd.length; i++)
	{
		var key = gAlwaysAdd[i].key;
		var val = gAlwaysAdd[i].value;
		var oldVal = stop.osmElement.tags[key];
		if (setRawAndTouched(stop.osmElement, key, val))
		{
			printTagUpdate("alwaysAdd", key, oldVal, val);
		}
	}

	// Handle name:lang
	function hasLetters(str)
	{
		return (str.search(/[^\s0-9\\\/\-\_\:\(\)\{\}\+]/) !== -1);
	}
	
	var langs = ["name:ar", "name:he", "name:en"];
	for (var i = 0; i < langs.length; i++)
	{
		var key = langs[i];
		var hasTouched;
		var val = stop.newEntry[key];
		var oldVal = stop.osmElement.tags[key];
		if ((val === undefined) || (val === "")) continue; // We have no string for this language. Skip it and allow mappers to set their own.
		if (hasLetters(val))
			hasTouched = setRawAndTouched(stop.osmElement, key, val);
		else
			hasTouched = setRawAndTouched(stop.osmElement, key, ""); // The stop name has no letters in this language. Delete it if present
		if (hasTouched)
			printTagUpdate("override", key, oldVal, val);
	}
	
	// Decide whether to do name:he --> name 
	// or name:ar --> name.
	var mapName = stop.osmElement.tags["name"];
	var mapNameIsArabic = false;
	if ((mapName !== undefined) && (mapName.search(/[\u0600-\u06FF]/) !== -1)) // at least 1 ar letter
		mapNameIsArabic = true;
	var hasTouched;
	if (mapNameIsArabic)
	{
		// if MOT has an Arabic name
		if ((stop.newEntry["name:ar"] !== undefined) && (stop.newEntry["name:ar"] !== null) && (stop.newEntry["name:ar"] !== ""))
		{
			hasTouched = setRawAndTouched(stop.osmElement, "name", stop.newEntry["name:ar"]);
		}
		else
		{
			// MOT has no Arabic name, but the map does and it's in the "name" tag. do nothing, but log this. 
			gStats.nonMOT_arabic_name++;
			print("AR-NAME: " + stop.osmElement.tags["ref"] + ". Has a non-MOT provided Arabic name in the 'name' tag. name="+mapName);
		}
	}
	else
	{
		hasTouched = setRawAndTouched(stop.osmElement, "name", stop.newEntry["name:he"]);
	}
	
	if (hasTouched) printTagUpdate("override", key, oldVal, val);

	if (isCreated)
	{
		return;
	}
	
	// The code below is for modified (non created) stops only.
	
	// Delete legacy tag
	if (stop.osmElement.tags["gtfs:verified"] !== undefined)
	{
		stop.osmElement.removeTag("gtfs:verified");
	}
	
	// If MOT have updated their position, override the current position.
	if ((stop.oldEntry === null) || (stop.oldEntry["lat"] !== stop.newEntry["lat"]) || (stop.oldEntry["lon"] !== stop.newEntry["lon"]))
	{
		if ((stop.osmElement.lat !== stop.newEntry.lat) || (stop.osmElement.lon !== stop.newEntry.lon))
		{
			stop.osmElement.pos = {lat: stop.newEntry.lat, lon: stop.newEntry.lon};
			touched = true;
		}
	}
	
	// Check if the current position differs from the latest MOT position. Decide whether or not to override based on distance.
	if ((stop.newEntry["lat"] != stop.osmElement.lat) || (stop.newEntry["lon"] != stop.osmElement.lon))
	{
		var distance = getDistanceFromLatLonInM(stop.newEntry.lat, stop.newEntry.lon, stop.osmElement.lat, stop.osmElement.lon).toFixed(2);
		if (distance < SNAP_THRESHOLD)
		{
			// The spacial desync is too small. Usually an unintentional mapper micro-movement. Snap it back to gtfs values. (override)
			print("SNAP: " + distance + "m: " + stop.osmElement.tags.ref + " spacial desync. osm=("+
				stop.osmElement.lon+","+stop.osmElement.lat+"), gtfs=("+stop.newEntry.lon+","+stop.newEntry.lat+")");
			stop.osmElement.pos = {lat: stop.newEntry.lat, lon: stop.newEntry.lon};
			gStats.update_spacialDesync_snap++;
			touched = true;
		}
		else 
		{
			// Trust the OSM user's position and keep it. Log it for possible future inspection.
			if (distance >= PRINT_SPACIAL_THRESHOLD)
			{
				print("DESYNC: " + distance + "m: " + stop.osmElement.tags.ref + " spacial desync. osm=("+
					stop.osmElement.lon+","+stop.osmElement.lat+"), gtfs=("+stop.newEntry.lon+","+stop.newEntry.lat+")");
			}
			gStats.update_spacialDesync_ignore++;
		}
	}
	
	if (touched)
	{
		gStats.update_touched++;
		gStats.touched++; // Created stops bail out early and this is never reached. Their increment happens in busStopCreate()
	}
	else
	{
		gStats.update_not_touched++;
	}
}

function busStopCreate(stop, ds)
{
	gStats.create++;
	gStats.touched++;
	gStats.total_OsmAfterRun++;
	var nb = builder.NodeBuilder;
	var node = nb.create({lat: stop.newEntry.lat, lon: stop.newEntry.lon});
	ds.add(node);
	stop.osmElement = node;
	node.tags.highway = "bus_stop";
	busStopUpdate(stop, true);
}

function busStopDelete(stop, layer)
{
	gStats.del++;
	gStats.touched++;
	gStats.total_OsmAfterRun--;
	del(stop.osmElement, layer);
}



////////////////////////////// Other



function performSanityChecks()
{
	var s = gStats;
	if (s.ddx_del + s.xdx_delete != s.del) print("ASSERT FAIL - delete");
	if (s.dxd_create + s.xxd_create != s.create) print("ASSERT FAIL - create");
	if (s.dxx_update + s.xxx_update != s.update) print("ASSERT FAIL - update");
	if (s.update_touched + s.create + s.del != s.touched) print("ASSERT FAIL - touches");
	if (s.total_OsmBeforeRun + s.create - s.del != s.total_OsmAfterRun) 
		print("ASSERT FAIL - beforeAfter" + s.total_OsmBeforeRun + "+" + s.create + "-" + s.del + "=" + s.total_OsmAfterRun);
	if (s.ddx_nothing + s.xdd_nothing + s.xxd_nothing != s.nothing) print("ASSERT FAIL - nothing");
	if (s.update_touched + s.update_not_touched != s.update) print("ASSERT FAIL - updateTouches");
	if (s.total_newGTFS + s.ddx_nothing - s.xxd_nothing != s.total_OsmAfterRun) print("ASSERT FAIL - finalBusStopSum");
	if (trainStationTempCnt < 210) print("ASSERT FAIL - Trainstation hack likely stopped working.");
}

main();

})();
