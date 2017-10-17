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
function getDistanceFromLatLonInKm(lat1,lon1,lat2,lon2) {
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
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI/180)
}

var gStats = {
	ddd: 0, ddx: 0, dxd: 0, dxx: 0, xdd: 0, xdx: 0, xxd: 0, xxx: 0,
	update: 0, create: 0, del: 0, nothing: 0,
	touched: 0, // create + update which actually did something
	total_newGTFS: 0,
	total_oldGTFS: 0,
	total_OsmBeforeRun: 0,
	total_OsmAfterRun: 0
}

function main()
{
	var ds = josm.layers.get(0).data;
	
	print("");
	print("### Running script");
	
	var gtfs = {}; // GTFS entries that need to be updated, created, or deleted in OSM.
	
	function lineToGtfsEntry(line)
	{
		var arr = line.split(",");
		var gtfsEntry = {};
		gtfsEntry["ref"] = arr[0].trim();         // stop_code
		gtfsEntry["name"] = arr[1].trim();        // stop_name
		gtfsEntry["description"] = arr[2].replace(" רציף:   קומה:  ", "").trim(); // stop_desc
		gtfsEntry["lat"] = Number(arr[3].trim()); // stop_lat
		gtfsEntry["lon"] = Number(arr[4].trim()); // stop_lon
		return gtfsEntry;
	}
	
	var FATAL = false; // If true, fatal error. Abort.
	
	// The new_delta file has lines that are only present in the new database.
	readFile_forEach("/home/osm/openStreetMap/gtfs/new/parsed.txt", function(line)
	{
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
	

	// The old_delta file has lines that are only present in the new database.
	readFile_forEach("/home/osm/openStreetMap/gtfs/old/parsed.txt", function(line)
	{
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
	
	// iterate all gtfs entries
	var cnt1 = 0;
	var cnt2 = 0;
	for (var ref in gtfs)
	{
		if (gtfs.hasOwnProperty(ref))
		{
			var stop = gtfs[ref];
			
			// - - -  => N/A
			// - - X  => Nothing. 
			if ((stop.oldEntry === null) && (stop.newEntry === null))
			{
				print("FATAL. this should never happen");
				return;
			}
			
			var match = matchGtfEntryToAnOsmElement(osm_ref, stop);
			stop.osmElement = match;
			
			// ? ? -
			if (match == null)
			{
				continue;
				if ((stop.oldEntry === null) && (stop.newEntry !== null))
				{
					print("- X -: " + ref + ". Create.");
					busStopCreate(ds, stop);
				}
				// X - -
				if ((stop.oldEntry !== null) && (stop.newEntry === null))
				{
					print("X - -: " + ref + ". Nothing.");
				}
				// X X -
				if ((stop.oldEntry !== null) && (stop.newEntry !== null))
				{
					print("X X -: " + ref + ". Create.");
					busStopCreate(ds, stop);
				}
			}
			// ? ? X
			else
			{
				//stop.osmElement.lat = 34;
				//stop.osmElement.lon = 35;
				stop.osmElement.pos = {lat: 34, lon: 35};
				continue;
				
				if ((stop.oldEntry === null) && (stop.newEntry !== null))
				{
					print("- X X: " + ref + ". Update. id: " + match.id);
					busStopUpdate(stop);
					cnt1++;
				}
				if ((stop.oldEntry !== null) && (stop.newEntry === null))
				{
					print("X - X: " + ref + ". Delete. id: " + match.id);
					busStopDelete(ds, stop);
				}
				if ((stop.oldEntry !== null) && (stop.newEntry !== null))
				{
					print("X X X: " + ref + ". Update. id: " + match.id);
					busStopUpdate(stop);
					cnt2++;
				}
			}
		}
	}
	print("" + cnt1);
	print("" + cnt2);
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
	
	return FATAL;
}

function matchGtfEntryToAnOsmElement(osm_ref, stop)
{
		var entry = (stop.newEntry === null ? stop.oldEntry : stop.newEntry);
		var matchingOsmElements;
		var ref = entry["ref"];
		var matchingOsmElement = osm_ref[ref];
		if (matchingOsmElement === undefined)
			return null;
		
		return matchingOsmElement;
}

function setIfNotSet(osmNode, key, value)
{
	 // prevents "touching" nodes without changing them. Adding them needlessly to the changeset
	if (osmNode.tags[key] !== value)
		osmNode.tags[key] = value;
}

function setIfNotSetAndChanged(key, stop)
{
	// Only touch the values that have been. either changed between old db and new db
	// 2. don't exist in old db.
	if ((stop.oldEntry === null) || (stop.oldEntry[key] !== stop.newEntry[key]))
	{
		var value = stop.newEntry[key];
		if (stop.osmElement.tags[key] !== value)
			stop.osmElement.tags[key] = value;
	}
}

function setIfNotSetAndChangedCords(key, stop)
{
	if ((stop.oldEntry === null) || (stop.oldEntry[key] !== stop.newEntry[key]))
	{
		// var value = stop.newEntry[key];
		/*
		*/
		stop.osmElement[key] = stop.newEntry[key];
	}
}



function busStopUpdate(stop, isCreated)
{
	if (isCreated === undefined) isCreated = false;
	
	if (!isCreated)
	{
		var distance = getDistanceFromLatLonInKm(stop.newEntry.lat, stop.newEntry.lon, stop.osmElement.lat, stop.osmElement.lon) * 1000;
		if (distance > 50)
		{
			print("WARN: bus stop " + distance + "m from where it should be. Skipped. ref: " 
				+ stop.osmElement.tags["ref"] + " id: " + stop.osmElement.id);
			return false;
		}
	}
	
	var touched = false;
	touched = setIfNotSetAndChanged("ref", stop) || touched;
	touched = setIfNotSetAndChanged("name",stop) || touched;
	touched = setIfNotSetAndChanged("description", stop) || touched;
	
	if (isCreated) return;
	if ((stop.oldEntry === null) || (stop.oldEntry["lat"] !== stop.newEntry["lat"]) || (stop.oldEntry["lon"] !== stop.newEntry["lon"]))
	{
		/*if ((stop.osmElement.lat !== stop.newEntry.lat) || (stop.osmElement.lon !== stop.newEntry.lon))
			stop.osmElement.pos = {lat: stop.newEntry.lat, lon: stop.newEntry.lon};*/
			
		/*if (stop.osmElement.lat !== stop.newEntry.lat)
		{
			stop.osmElement.lat = stop.newEntry.lat;
			touched = true;
		}
		if (stop.osmElement.lon !== stop.newEntry.lon)
		{
			stop.osmElement.lon = stop.newEntry.lon;
			touched = true;
		}*/
		
		stop.osmElement.lat = 34;
		stop.osmElement.lon = 35;
	}
	
	return touched;
}

function busStopCreate(ds, stop)
{
	var nb = builder.NodeBuilder;
	var node = nb.create({lat: stop.newEntry.lat, lon: stop.newEntry.lon});
	ds.add(node);
	stop.osmElement = node;
	node.tags.highway = "bus_stop";
	busStopUpdate(stop, true);
}

function busStopDelete(ds, stop)
{
	ds.remove(stop.osmElement.id, stop.osmElement.type);
}


main();

