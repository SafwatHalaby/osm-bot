/*
Script page: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/nameCopy
Last update: 17 Dec 2017
Typical node fetching query (Overpass API):

[out:xml][timeout:500][bbox:{{bbox}}];
(area(3601473946); area(3603791785);)->.a;
(
  node["name:ru"];
  way["name:ru"];
  relation["name:ru"];
);
out meta;

*/

var gReplaceTag = "name:ru"
var gReplaceTable = {
"Наси Бен-Цви Avenue": "проспект Наси Бен-Цви",
"ХаНамаль": "ХаНамель",
"Заменхоф": "Заменгоф"};

var print = require("josm/util").println;

function main()
{
	var cntModifiedFullMatch = 0;
	// var cntModifiedPartialMatch = 0;
	var cntAll = 0;


	for (key in gReplaceTable)
	{
		if (key.indexOf("Xa ") != -1)
		{
			gReplaceTable[key.replace("Xa ", "Xa")] = gReplaceTable[key];
			print(key.replace("Xa ", "Xa") + ">" + gReplaceTable[key.replace("Xa ", "Xa")]);
		}
	}

	print("");
	print("### Running script script");
	var layer = josm.layers.get("auto.osm");
	var ds = layer.data;
	ds.each(function(p){ // foreach element
		// if (p.tags["ignore_this_bot"] !== undefined) return;

		var originalName = p.tags[gReplaceTag];
		if (originalName === undefined) return; 
		var newName = gReplaceTable[originalName];
		if ((newName !== undefined) && (originalName != newName))
		{
			p.tags[gReplaceTag] = gReplaceTable[originalName];
			cntModifiedFullMatch++;
			return;
		}
		/* for (key in gReplaceTable)
		{
			if (originalName.indexOf(key) != -1)
			{
				p.tags[gReplaceTag] = originalName.replace(key, gReplaceTable[key]);
				originalName = p.tags[gReplaceTag];
				cntModifiedPartialMatch++;
			}
		} */
		cntAll++;
	});
	print("Total full match modifications: " + cntModifiedFullMatch);
	// print("Total partial match modifications: " + cntModifiedPartialMatch);
	print("Total scanned: " + cntAll);
	// print("Total unmodified: " + (cntAll - cntModifiedFullMatch - cntModifiedPartialMatch));
	print("Total unmodified: " + (cntAll - cntModifiedFullMatch));
	print("");
	print("### Script finished");
	// josm.commands.undo(1000);
}
main();

