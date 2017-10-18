var print = require("josm/util").println;
var builder= require("josm/builder");

/*
WORK IN PROGRESS 

[out:xml][timeout:90][bbox:29.5734571,34.1674805,33.4131022,35.925293];
(
area(3601473946);
area(3603791785);
)->.a;
(
  node["highway"="bus_stop"](area.a);
  way["highway"="bus_stop"](area.a);
);
out meta;
*/
//3601473946 - IL. 3603791785 - area C
/*



Column 1: Old Database
Column 2: New Database
Column 3: Openstreetmap

for each bus stop reference, find out in which columns it exists in which it doesn't.
If multiple bus stops have the same reference in any column, we halt.
Exception: platforms (ratzefeem) sometimes have db ref duplication that we merge into one.

X       : A single bus stop with that reference exists in that column
-       : No bus stop with that reference exists in that column
=>      : action to be taken

1 2 3
- - -  => N/A
- - X  => Nothing. (todo - delete?)
- X -  => Create.
X - -  => Nothing.
X X -  => Create.
- X X  => Update.
X - X  => Delete.
X X X  => Update.

Updating  only updates the keys where col1[key] != col2[key].
*/

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

// source https://stackoverflow.com/questions/27928/calculate-distance-between-two-latitude-longitude-points-haversine-formula
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

var gStats = {
	ddx_del: 0, ddx_nothing: 0, dxd_create: 0, dxx_update: 0, xdd_nothing: 0, xdx_delete: 0, xxd_create: 0, xxx_update: 0,
	update: 0,                        /* Total updates (update_touched + update_not_touched) */
	update_touched: 0                 /* Total updates that actually changed something */,
	update_not_touched: 0,            /* Total bus stop update attempts that didn't need to change any tags */
	update_distanceTooFar_skipped: 0, /* Total updates that were skipped because the position changed significantly */
	update_distanceTooFar_ignored: 0, /* Total updates that were done despite the position changing significantly */
	create: 0,                        /* Total created stops (dxd_create+xxd_create) */
	del: 0,                           /* Total deleted stops (ddx_del+xdx_delete) */
	nothing: 0,                       /* Total stops where no action was taken (xdd_nothing+ddx_nothing) */
	touched: 0,                       /* create + del + update + update_touched */
	total_newGTFS: 0,                 /* total bus stop lines in the new GTFS file */
	total_oldGTFS: 0,                 /* total bus stop lines in the old GTFS file */
	total_OsmBeforeRun: 0,            /* Total "ref" carrying stops in Israel, prior to the run */
	total_OsmAfterRun: 0              /* Total "ref" carrying stops in Israel, after the run (total_OsmBeforeRun+created-deleted) */ 
}

function main()
{
	var ds = josm.layers.get(0).data;
	
	print("");
	print("### Running script");
	
	var gtfs = {}; // Contains objects that look like this: {newEntry: <obj>, oldEntry: <obj>, osmElement: <obj>}
	// Where newEntry is grabbed from the new GTFS, old from the old one, and osmElement from the dataset.
	
	function lineToGtfsEntry(line)
	{
		var arr = line.split(",");
		var gtfsEntry = {};
		gtfsEntry["ref"] = arr[0].trim();         // stop_code
		gtfsEntry["name"] = arr[1].trim();        // stop_name
		gtfsEntry["name:he"] = gtfsEntry["name"]; // stop_name (he)
		gtfsEntry["description"] = arr[2].replace(" רציף:   קומה:  ", "").trim(); // stop_desc
		gtfsEntry["lat"] = Number(arr[3].trim()); // stop_lat
		gtfsEntry["lon"] = Number(arr[4].trim()); // stop_lon
		return gtfsEntry;
	}
	
	var FATAL = false; // If true, fatal error. Abort.
	
	// Read lines from new DB, and fill "gtfs".
	readFile_forEach("/home/osm/openStreetMap/gtfs/new/parsed.txt", function(line)
	{
	  gStats.total_newGTFS++;
	  var newE = lineToGtfsEntry(line+"");
	  var ref = newE["ref"];
	  if (gtfs[ref] !== undefined)
	  {
			return; // todo handle platforms
			print("FATAL: Two gtfs entries with same ref in new db: " + ref);
			FATAL = true;
	  }
	  gtfs[ref] = {newEntry: newE, oldEntry: null, osmElement: null};
	});
	

	// Read lines from old DB, and fill "gtfs".
	readFile_forEach("/home/osm/openStreetMap/gtfs/old/parsed.txt", function(line)
	{
		gStats.total_oldGTFS++;
		var oldE = lineToGtfsEntry(line);
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
		gtfs[ref].oldEntry = oldE;
	});
	
	var osm_ref = {};        // ref -> osmElement dictionary.
	FATAL = initOsmRef(osm_ref, ds) || FATAL; // fills that dictionary. return false if some bus stops have the same ref.
	

	if (FATAL)
	{
		print("### Script canceled");
		return;
	}
	
	// iterate all "gtfs" objects, decide what to do with each
	for (var ref in gtfs)
	{
		if (gtfs.hasOwnProperty(ref))
		{
			var stop = gtfs[ref];
			
			// - - -  => N/A
			if ((stop.oldEntry === null) && (stop.newEntry === null))
			{
				print("FATAL. this should never happen");
				return;
			}
			
			var match = matchGtfEntryToAnOsmElement(osm_ref, stop); // whatever osmElement is returned is also removed from osm_ref
			stop.osmElement = match;
			
			// ? ? -
			if (match == null)
			{
				if ((stop.oldEntry === null) && (stop.newEntry !== null))
				{
					print("- X -: " + ref + ". Create.");
					gStats.dxd_create++;
					busStopCreate(ds, stop);
				}
				// X - -
				if ((stop.oldEntry !== null) && (stop.newEntry === null))
				{
					print("X - -: " + ref + ". Nothing.");
					gStats.xdd_nothing++;
					gStats.nothing++;
				}
				// X X -
				if ((stop.oldEntry !== null) && (stop.newEntry !== null))
				{
					print("X X -: " + ref + ". Create.");
					gStats.xxd_create++;
					busStopCreate(ds, stop);
				}
			}
			// ? ? X
			else
			{	
				if ((stop.oldEntry === null) && (stop.newEntry !== null))
				{
					print("- X X: " + ref + ". Update. id: " + match.id);
					gStats.dxx_update++;
					busStopUpdate(stop);
				}
				if ((stop.oldEntry !== null) && (stop.newEntry === null))
				{
					print("X - X: " + ref + ". Delete. id: " + match.id);
					gStats.xdx_delete++;
					busStopDelete(ds, stop);
				}
				if ((stop.oldEntry !== null) && (stop.newEntry !== null))
				{
					print("X X X: " + ref + ". Update. id: " + match.id);
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
				print("- - X: " + ref + ". Delete (has source=gtfs). id: " + el.id);	
				busStopDelete(ds, {osmElement: el});
			}
			else
			{
				print("- - X: " + ref + ". Nothing (doesn't have source=gtfs). id: " + el.id);	
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

	// sanity checks on the stats
	performSanityChecks();

	print("### Script finished");
}

function initOsmRef(osm_ref, ds)
{
	var FATAL = false;
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
			}			
	});
	gStats.total_OsmAfterRun = gStats.total_OsmBeforeRun;
	return FATAL;
}

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

function setIfNotSet(osmNode, key, value)
{
	 // prevents "touching" nodes without changing them. Adding them needlessly to the changeset
	if (osmNode.tags[key] !== value)
		osmNode.tags[key] = value;
}

function setIfNotSetAndChanged(key, stop)
{
	// Only touch the values that have been either changed between old db and new db
	// 2. don't exist in old db.
	if ((stop.oldEntry === null) || (stop.oldEntry[key] !== stop.newEntry[key]))
	{
		var value = stop.newEntry[key];
		if (stop.osmElement.tags[key] !== value)
		{
			stop.osmElement.tags[key] = value;
			return true;
		}
	}
	return false;
}

function busStopUpdate(stop, isCreated)
{
	
	if (isCreated === undefined)
	{
		isCreated = false;
		gStats.update++;
	}
	
	// These checks are probably useless on first run. There have been major changes since 2012. Almost all "warnings" are expected to be false positives.
	/*if (!isCreated)
	{
	* 
		var distance = getDistanceFromLatLonInM(stop.newEntry.lat, stop.newEntry.lon, stop.osmElement.lat, stop.osmElement.lon);
		if (distance > 50)
		{
			// the bus stop is about to be moved more than 50 meters, something could be wrong
			
			if ((stop.oldEntry != null) && (getDistanceFromLatLonInM(stop.oldEntry.lat, stop.oldEntry.lon, stop.osmElement.lat, stop.osmElement.lon) < 20))
			{
				// The distance difference happened due to difference from the older database, continue
				print("INFO: bus stop " + distance + "m from where it should be. Continued anyways. ref: " + stop.osmElement.tags["ref"] + " id: " + stop.osmElement.id);
				stop.osmElement.tags["DEBUG111"] = "debug";
				gStats.update_distanceTooFar_ignored++;
			}
			else
			{
				// The distance difference happened because a mapper moved this stop. The mapper and the GTFS DB disagree significantly. Warn!
				print("WARN: bus stop " + distance + "m from where it should be. Skipped. ref: " 
					+ stop.osmElement.tags["ref"] + " id: " + stop.osmElement.id);
				gStats.update_not_touched++;
				stop.osmElement.tags["DEBUG222"] = "debug";
				gStats.update_distanceTooFar_skipped++;
				return false;
			}
		}

	}*/
	
	var touched = false;
	touched = setIfNotSetAndChanged("ref", stop) || touched;
	touched = setIfNotSetAndChanged("name",stop) || touched;
	touched = setIfNotSetAndChanged("name:he",stop) || touched;
	touched = setIfNotSetAndChanged("description", stop) || touched;
	
	if (isCreated) return;
	if ((stop.oldEntry === null) || (stop.oldEntry["lat"] !== stop.newEntry["lat"]) || (stop.oldEntry["lon"] !== stop.newEntry["lon"]))
	{
		if ((stop.osmElement.lat !== stop.newEntry.lat) || (stop.osmElement.lon !== stop.newEntry.lon))
		{
			stop.osmElement.pos = {lat: stop.newEntry.lat, lon: stop.newEntry.lon};
			touched = true;
		}
	}
	
	if (touched)
	{
		gStats.update_touched++;
		gStats.touched++;
	}
	else
	{
		gStats.update_not_touched++;
	}
}

function busStopCreate(ds, stop)
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

function busStopDelete(ds, stop)
{
	gStats.del++;
	gStats.touched++;
	gStats.total_OsmAfterRun--;
	ds.remove(stop.osmElement.id, stop.osmElement.type);
}

function performSanityChecks()
{
	var s = gStats;
	if (s.ddx_del + s.xdx_delete != s.del) print("ASSERT FAIL - delete");
	if (s.dxd_create + s.xxd_create != s.create) print("ASSERT FAIL - create");
	if (s.dxx_update + s.xxx_update != s.update) print("ASSERT FAIL - update");
	if (s.update_touched + s.create + s.del != s.touched) print("ASSERT FAIL - touches");
	if (s.total_OsmBeforeRun + s.create - s.del != s.total_OsmAfterRun) 
		print("ASSERT FAIL - beforeAfter" + s.total_OsmBeforeRun + "+" + s.create + "-" + s.del + "=" + s.total_OsmAfterRun);
	if (s.ddx_nothing + s.xdd_nothing != s.nothing) print("ASSERT FAIL - nothing");
	if (s.update_touched + s.update_not_touched != s.update) print("ASSERT FAIL - updateTouches");
}

main();
