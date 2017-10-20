var print = require("josm/util").println;
var File = java.io.File;
var BufferedWriter = java.io.BufferedWriter;
var OutputStreamWriter = java.io.OutputStreamWriter;
var FileOutputStream = java.io.FileOutputStream


var fout = new File("/home/osm/out.txt");
var fos = new FileOutputStream(fout);

var bw = new BufferedWriter(new OutputStreamWriter(fos));

var layer = josm.layers.get(0); // download this layer through the overpass query above
var ds = layer.data;
ds.each(function(p)
{
		
		var tags = p.tags;
		
		if (tags["source"] != "israel_gtfs_v1")
		{
				print("Skipped " + p.id);
				return;
		}
		var str = tags["gtfs:id"]  
		+ "," + tags["ref"]
		+ "," + tags["name"]
		+ "," + tags["description"]
		+ "," + p.lat
		+ "," + p.lon;
		bw.write(str);
		bw.newLine();
});
	
bw.close();
