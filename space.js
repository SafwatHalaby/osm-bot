var print = require("josm/util").println;
var layer = josm.layers.get(0);
var ds = layer.data;
var command = require("josm/command");

// last update 19 dec 2017

// A generic script for tasks that require comparing distances between nearby OSM elements efficiently..
// Currently used to merge duplicate bus stops, but you can modify it to do anything distance-related:
// Simply modify filter(p), compare(p1, p2), gCellSize_meters, and perhaps gStats for statistics.

// Algorithm complexity:
// The spacial algorithm divides the region into cells/buckets that are "gCellSize_meters" large, and puts
// each element in its corresponding bucket. Afterwards, elements are only compared with elements in their
// own bucket, or in adjacent buckets. This makes the complexity approx O(N), assumming uniform distribution
// without too many elements in each bucket. It's far better than the slow O(N^2) of naively comparing every
// element in the dataset with every other element. If all elements are in the same cell/bucket, this
// algorithm will run in a slow worst case of O(N^2). A cell/bucket is gCellSize_meters x gCellSize_meters
// large. Enlarging gCellSize_meters will reduce memory usage but increase CPU usage, and vice-versa.
// gCellSize_meters must be at least as large as the maximum distance you want to compare. In other words, 
// two elements that are farther than gCellSize_meters are not guaranteed to be compared and compare(p1, p2)
// may not be called on them.

var gCellSize_meters = 100;
 
// First, this function is called for the entire dataset, return "true" for the elements that
// are interesting to you return false for anything you want to ignore.
// The more you ignore, the faster the algorithm runs.
function filter(p)
{
	if (p.tags["highway"] === "bus_stop")
	{
		gStats.total++;
		return true;
	}
	return false;
}

// once "filter" is called for all elements, this function is
// guaranteed to be called for every 2 elements that weren't filtered, and that are "gCellSize_meters" meters or less far apart
// may be called for additional elements too.
// Performed twice for every nearby pair, (p1 and p2 will swap on the second call)
function compare(p1, p2)
{
	if ((p1.tags.ref !== undefined) && 
	(p2.tags.ref === undefined))
	{
		var dist = distance(p1, p2);
		if (dist < 50) 
		{
			removeFromGrid(p2); // element won't be further involved in any comparisons
			for (key in p2.tags)
			{
				if (p2.tags.hasOwnProperty(key) && (key != "highway"))
				{
					gStats.manual++;
					print(p2.id + " requires manual check/merge. Compare it with " + p1.id + " (" + dist + "m)");
					return;
				}
			}
			gStats.del++;	
			del(p2); // element will be removed from the dataset (must call removeFromGrid first)
		}
	}
}

// called once at the start, before filter(p) is called on all elements.
function initialize()
{
	return;
}

// called once at the end, when all comparisons are done
function finalize()
{
		gStats.leftAlone = gStats.total - gStats.del - gStats.manual;
}

var gStats = {
	del: 0,       // auto merged (one of the stops only had highway=bus_stop with no other tags, and less than 50 meters apart from a ref-carrying stop)
	manual: 0,    // Should merge: requires manual intervention (less than 50 meters apart, but both have extra tags).
	leftAlone: 0, // untouched bus stops
	total: 0      // Total bus stops
}

/** Helper functions **/

// removes element from the spacial grid, preventing any further comparisons on it
// does not remove from the dataset
function removeFromGrid(p)
{
	gRemoved[p.id] = true;
	var cords = latLonToGrid(p.lat, p.lon);
	gGrid[cords.x][cords.y].splice(gGrid[cords.x][cords.y].indexOf(p), 1); // remove from grid
}

// must call removeFromGrid first
function del(p)
{
	layer.apply(command.delete(p));
}

// returns distance between two osm elements in meters. Not 100% accurate and does not take earth elevation into account, but pretty good.
// source https://stackoverflow.com/questions/27928/calculate-distance-between-two-latitude-longitude-points-haversine-formula
function distance(element1, element2) {
	var lat1 = element1.lat;
	var lat2 = element2.lat;
	var lon1 = element1.lon;
	var lon2 = element2.lon;
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


//Spacial algorithm. Typically you wouldn't modify the code below.
//___________________________________
//___________________________________
//___________________________________


var gCellSize =  0.00001 * gCellSize_meters; // An approximation. 0.00001 in lat/lon is slightly more than a meter (CONFIRM?).
var gMinLat = 1000, gMaxLat = -1, gMinLon = 1000, gMaxLon = -1;
var gGrid = [];
var gRemoved;
function latLonToGrid(lat, lon)
{
	lat = lat - gMinLat;
	lon = lon - gMinLon;
	var x_ = Math.floor(lon / gCellSize);
	var y_ = Math.floor(lat / gCellSize);
	return {x: x_, y: y_};
}
function pushEl(x, y, p)
{
	if (gGrid[x] === undefined) gGrid[x] = [];
	if (gGrid[x][y] === undefined) gGrid[x][y] = [];
	gGrid[x][y].push(p);
}

function main()
{
	
	print("");
	print("### Running script");
	initialize();
	

	ds.each(function(p)
	{
		if (p.lon < gMinLon)
                {
                   gMinLon = p.lon;
                }
		if (p.lat < gMinLat)
                {
                   gMinLat = p.lat;
                }
		if (p.lon > gMaxLon)
                {
                   gMaxLon = p.lon; // unused
                }
		if (p.lat > gMaxLat)
                {
                   gMaxLat = p.lat; // unused
                }
	});

	var sum1 = 0;
	ds.each(function(p)
	{
		if (!filter(p)) return;
		var cords = latLonToGrid(p.lat, p.lon);
		pushEl(cords.x, cords.y, p);
		sum1++;
	});

	var maxLen = -1;
	for (x in gGrid)
	{
		if (gGrid.hasOwnProperty(x))
		{
			for (y in gGrid[x]) 
			{
				if (gGrid[x].hasOwnProperty(y))
				{
					x = Number(x);
					y = Number(y);
					gRemoved = {};
					var arrUs = gGrid[x][y].slice(); // slice(copy) prevents index invalidation on deleting elements from grid
					var arrThem = join9cells(x, y);
					if (arrUs.length > maxLen) maxLen = arrUs.length;
					
					for (var i = 0; i < arrUs.length; ++i)
					for (var j = 0; j < arrThem.length; ++j)
					{
						if (arrUs[i] === arrThem[j]) continue;
						if ((gRemoved[arrUs[i].id] === true) || (gRemoved[arrThem[j].id] === true)) continue;
						compare(arrUs[i], arrThem[j]);
					}
				}
			}
		}
	}
	
	print("The most dense " + gCellSize_meters + "x" + gCellSize_meters + " meter grid cell has " + maxLen + " bus stops.");
	finalize();
	for (stat in gStats)
	{
		print(stat + ": " + gStats[stat]);
	}
	print("### Script finished");
}

function join9cells(centerX, centerY)
{
	var iterator = make9CellIterator(centerX, centerY);
	var next = iterator.next();
	var ret = [];
	while (next !== null)
	{
		ret.push(next);
		next = iterator.next();
	}
	return ret;	
}

function make9CellIterator(x, y) {

	var nextIndex = 0;
	var nextArrayX = -2;
	var nextArrayY = -1;
	var currentArr = undefined;

	return { next: function() {
		while ((currentArr === undefined) || (nextIndex === currentArr.length))
		{
			nextArrayX++;
			if (nextArrayX == 2)
			{
				nextArrayX = -1;
				nextArrayY++;
				if (nextArrayY == 2)
				{
					return null;
				}
			}
			arrX = gGrid[x + nextArrayX];
			if (arrX !== undefined)
			{
				currentArr = arrX[y + nextArrayY];
				if (currentArr !== undefined)
				{
					nextIndex = 0;
				}
			}
		}
		nextIndex++;
		return currentArr[nextIndex - 1];
	}};
}

main();
