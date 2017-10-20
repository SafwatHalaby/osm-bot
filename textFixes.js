// node[~"."~"([\u00A0\u0020][\u00A0\u0020]+|$[\u00A0\u0020]|[\u00A0\u0020]^)"](area.a);
/*
WORK IN PROGRESS 
*/

var print = require("josm/util").println;
var layer = josm.layers.get(0);
var ds = layer.data; 

function main()
{
	var fixes = [
		{name: "Double whitespace fix", regex: /[\u00A0\u0020][\u00A0\u0020]+/, replaceWith: " "},
		{name: "Whitespace trim", func: function(str){return str.trim();}}
	]
	
	initStats(fixes); // set all fixes[i] counters to 0
	
	print("### Running script - textFixes.js");
	ds.each(function(p){ 
		for (key in p.tags)
		{
			for (var i = 0; i < fixes.length; ++i)
			{
				applyFixToKey(p, fixes[i], key);
			}
		}
		for (key in p.tags)
		{
			for (var i = 0; i < fixes.length; ++i)
			{
				applyFixToValue(p, fixes[i], key);
			}
		}
	});

	print("==Fix stats==");
	
	for (var i = 0; i < fixes.length; ++i)
	{
		var fix = fixes[i];
		print(fix.name + ": " + fix.stats);
	}
	
	print("### Script finished");
}

function applyFixToKey(p, fix, key)
{
	var newKey = applyFixToStr(fix, key);
	if ((newKey !== null) && (key !== newKey))
	{
		p.tags[newKey] = p.tags[key];
		p.removeTag(key);
		fix.stats++;
	}
	
}

function applyFixToValue(p, fix, key)
{
	var value = p.tags[key];
	var newValue = applyFixToStr(fix, value);
	if ((newValue !== null) && (newValue !== value))
	{
		p.tags[key] = newValue;
		fix.stats++;
	}
}

function applyFixToStr(fix, str)
{
	if (fix.func === undefined)
		return str.replace(fix.regex, fix.replaceWith);
	else
		return fix.func(str);
}

function initStats(fixes)
{
	for (var i = 0; i < fixes.length; ++i)
	{
		fixes.stats = 0;
	}
}
main();

