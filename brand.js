/*
Script page: https://wiki.openstreetmap.org/wiki/User:SafwatHalaby/scripts/brand
Last update: 17 Dec 2017
Typical node fetching query (Overpass API):

[out:xml][timeout:60][bbox:29.5734571,34.1674805,33.4131022,35.925293];
(area(3601473946); area(3603791785);)->.a;
(
  node["amenity"](if: t["amenity"] == "bank" || t["amenity"] == "pharmacy" || t["amenity"] == "fuel" || t["amenity"] == "fast_food")(area.a);
  way["amenity"](if: t["amenity"] == "bank" || t["amenity"] == "pharmacy" || t["amenity"] == "fuel" || t["amenity"] == "fast_food")(area.a);
  rel["amenity"](if: t["amenity"] == "bank" || t["amenity"] == "pharmacy" || t["amenity"] == "fuel" || t["amenity"] == "fast_food")(area.a);

  node["shop"="supermarket"](area.a);
  way["shop"="supermarket"](area.a);
  rel["shop"="supermarket"](area.a);
);
out meta;
*/

var util = require("josm/util");
var print = util.println;
var command = require("josm/command");
var DELETE = "KZZCSIAACM"

print("");
print("### Running script");


var brandsArray = [];
brandsArray = brandsArray.concat(require("templates/fuel").templates);
brandsArray = brandsArray.concat(require("templates/banks").templates);
brandsArray = brandsArray.concat(require("templates/supermarkets").templates);
brandsArray = brandsArray.concat(require("templates/pharmacies").templates);
brandsArray = brandsArray.concat(require("templates/food").templates);
var settings = require("templates/brandSettings").data;


// ########### globals
var gStats_all = 0;               // All scanned primitives counter
var gStats_detected = 0;          // All detected branches counter
var gStats_modified = 0;          // All modified branches counter
var gStats_brands = 0;            // All brands in the system counter
var gStats_brandsIncVariants = 0; // All brands, inc. variants in the system counter
var gStats_warnings = 0;          // warnings counter
var gStats_info = 0;          	  // info counter
var gStats_serious = 0;          // serious error counter

var gBrandTable = {}; // string => brand object
var printV;           // The print verbose function. Defined to be either a spacefiller or identical to print based on settings.verbose, see main.

function printWarning(p, str)
{
	print("WARNING, " + p.id + ":" + str);
	gStats_warnings += 1;
}

function printInfo(p, str)
{
	print("INFO, " + p.id + ":" + str);
	gStats_info += 1;
}

function printSerious(p, str)
{
	print("SERIOUS, " + p.id + ":" + str);
	gStats_serious += 1;
}

// ############## Functions
// custom Remove to fix the bug https://forum.openstreetmap.org/viewtopic.php?id=58375
var remove;
(function()
{
	var removeFunction;
	var builder= require("josm/builder");
	var nb = builder.NodeBuilder;
	var tempNode = nb.withPosition(10,10).create();
	removeFunction = tempNode.remove;
	remove = function remove(p, tag)
	{
		removeFunction.call(p, tag);
	}
})();

function normalize(str)
{
	// \u0000-\u002F - non printables some ascii symbols: <space>!"#$%&'()*+,-./
	// \u003A-\u0040 - Some more ascii symbols: :;<=>?@
	// \u005A-\u0060 - Some more ascii symbols: [\]^_`
	// \u007B-\u007F - Some more ascii symbols:  {|}~<del>
	// \u00A0 - nbsp. An alternative unicode version of <space> common throughout OSM
	// \u0060 - unicode version of `
	return str.replace(/[\u0000-\u002F\u003A-\u0040\u005A-\u0060\u007B-\u007F\u00A0\u0060]/g, "").toLowerCase()
}

// ret: brand or null
function matchString(str) // match string to brand
{
	if ((str === undefined) || (str === null)) return null;
	str = normalize(str);
	if (str == "") return null;
	if (gBrandTable[str] === undefined) return null;
	return gBrandTable[str];
}

// ret: brand or null
function matchStringFuzzy(str) // match string to brand (fuzzy)
{
	// I don't think I really should deal with multiple matches here e.g. brand="sonol paz". 
	// It's quite rare, plus I am shown logs for fuzzy matches anyways.
	if ((str === undefined) || (str === null)) return null;
	var arr = str.split(" "); // value of POI key


	if (arr.length > 3)
	{
		for (var j = 3; j < arr.length; ++j)
		{
			var word = arr[j - 3] + arr[j - 2] + arr[j - 1] + arr[j]; 
			if (settings.fuzzyBlackList[word] === true) continue;
			var brand = matchString(word);
			if (brand != null) return brand;
		}
	}

	if (arr.length > 2)
	{
		for (var j = 2; j < arr.length; ++j)
		{
			var word = arr[j - 2] + arr[j - 1] + arr[j]; 
			if (settings.fuzzyBlackList[word] === true) continue;
			var brand = matchString(word);
			if (brand != null) return brand;
		}
	}


	if (arr.length > 1)
	{
		for (var j = 1; j < arr.length; ++j)
		{
			var word = arr[j - 1] + arr[j]; 
			if (settings.fuzzyBlackList[word] === true) continue;
			var brand = matchString(word);
			if (brand != null) return brand;
		}
	}

	for (var j = 0; j < arr.length; ++j)
	{
		var word = arr[j]; 
		if (settings.fuzzyBlackList[word] === true) continue;
		var brand = matchString(word);
		if (brand != null) return brand;
	}


	return null;
}

function main()
{
	if (settings.verbose)
		printV = print;
	else
		printV = function(){}


	if (!fillBrandTable()) return; // Builds a name => [brand object] hash table
	var layer = josm.layers.get(0);
	var ds = layer.data;
	ds.each(function(p){ // foreach element
		gStats_all += 1;
		var brand = matchPOI(p); // Attribute p to a brand, by comparing its tags whose keys are in settings.tagsToSearchPOI to gBrandTable
		if (brand != null) // If succeeded in finding a brand for the primitive p
		{
			gStats_detected += 1;


			if (settings.verbose)
			{
				// Is this a regular brand or a variant? If variant, find the parent brand (for print only).
				var more;
				if (brand.parentBrand != undefined) more = "(Variant of " + brand.parentBrand.tags[settings.printTag]+")";
				else more = "";
				printV(p.id + " is a branch of: " + brand.tags[settings.printTag] + more);
			}

			if (!settings.dryRun)
			{
				printV("previous tags:");
				printV(p.tags);
				printV("Modified tags:");
				var modified = applyBrand(p, brand); // with special treatment to name tags
				modified = removeOperatorIfNotUseful(p, brand) || modified;
				modified = removeBrandLang(p) || modified;
				modified = removeWkWdDuplicates(p) || modified;
				// todo bug in modified flag here, reapplynames 
				// applyBrand also prints the tags, in verbose mode.
				if (!modified) printV("None");
				else gStats_modified += 1;
			}
			else
			{
				printV("Not modified(dry run). Current tags:");
				printV(p.tags);
			}
			printV("");
		}
	});
	
	print("");
	print("Scanned: " + gStats_all + ", branches detected: " + gStats_detected + ", branches modified: " + gStats_modified);
	print("Total brands in system: " + gStats_brands + ", Including variants: " + gStats_brandsIncVariants);
	print("Serious: " + gStats_serious);
	print("Warning: " + gStats_warnings);
	print("Info: " + gStats_info);

}

function fillBrandTable()
{
	gStats_brands = brandsArray.length;
	gStats_brandsIncVariants = gStats_brands;
	function linkValueToBrand(brand, val, alt_find) // attribute val with brand in the brand table.
	{
		if (val == undefined) return true;
		val = normalize(val);
		if (val == "") return true;
		var matchedBrand = gBrandTable[val];
		if (matchedBrand != undefined)
		{
			if (matchedBrand != brand)
			{
				print("Error. The same value can be attributed to different brands:");
				print("Value: " + val);
				print("Brand1: " + gBrandTable[val][settings.printTag]);
				print("Brand2: " + brand.tags[settings.printTag]);
				return false;
			}
			else if (alt_find)
			{
				print("Redundancy: ");
				print("Value: " + val);
				print("Brand: " + brand.tags[settings.printTag]);
				return false;
			}
		}
		gBrandTable[val] = brand;
		return true;
	}

	function addBrandToTable(brand) // Process a brand or a  variant, add it to the table
	{
		var allGoodFlag = true;
		for (var j = 0; j < settings.tagsToAttributeBrand.length; ++j)
		{
			var val = brand.tags[settings.tagsToAttributeBrand[j]]; // The value to be attributed with the brand
			if (!linkValueToBrand(brand, val, false)) allGoodFlag = false;
		}
		if (brand.alt_find != undefined)
		{
			for (var j = 0; j < brand.alt_find.length; ++j)
			{
				if (!linkValueToBrand(brand, brand.alt_find[j], true)) allGoodFlag=false;
			}
		}
		for (var tt = 0; tt < settings.deleteForAll.length; ++tt)
		{
			brand.tags[settings.deleteForAll[tt]] = DELETE;
		} 
		return allGoodFlag;
	}


	var allGoodFlag = true;
	for (var i = 0; i < brandsArray.length; ++i)
	{
		var brand = brandsArray[i];
		if (!addBrandToTable(brand)) allGoodFlag=false;
		for (var j = 0; j < brand.variants.length; ++j)
		{
			var variant = brand.variants[j];
			gStats_brandsIncVariants += 1;
			variant.parentBrand = brand;
			if (!addBrandToTable(variant)) allGoodFlag=false;
		}
	}

	if (!allGoodFlag) return false;

	if (settings.printBrandTable)
	{
		print("Generated brands table: ");
		for (var brand in gBrandTable)
		{
			print (brand + " => " + gBrandTable[brand].tags[settings.printTag]);
		}
		print("");
	}
	return true;
}

// try matching primitive "p" to a brand.
// ret: brand or null
function matchPOI(p)
{
	if (p.tags.highway != undefined) return null; 
	// Some highway features e.g. bus stops are named after major amenities. Ignore them.
	// (This only reduces error noise. The lines below catch this anyways)

	var foundBrand = null;
	// Called for each brand candidate, to be further inspected for problems and for deciding which is the best candidate.
	function matchPOI_inner(brand)
	{
		if ((brand != undefined) && (brand != null))
		{
			if (brand === foundBrand) return true; // We matched the same brand twice (e.g. name="brand1", brand="brand1"), ignore.
			if (foundBrand === null)
			{
				foundBrand = brand;
			}
			else 
			{
				if (foundBrand.parentBrand == brand) return true; // The current brand is the parent of the found brand
				if (brand.parentBrand == foundBrand) // The current brand is the child of the found brand. More specific. Better.
				{
					foundBrand = brand;
				}
				else
				{
					printWarning(p, " appears to have tags that match two different company brands. Skipped. " + 
					"brand1: " + foundBrand.tags[settings.printTag] +", brand2: " + brand.tags[settings.printTag]);
					return false;
				}
			}
		}
		return true;
	}
	// see if any of these tags for corresponds to a known brand name
	
	for (var i = 0; i < settings.tagsToSearchPOI.length; ++i)
	{
		var value = p.tags[settings.tagsToSearchPOI[i]]; // value of POI key
		var brand = matchString(value);
		if (!matchPOI_inner(brand)) return null;
	}

	// attempt word-by-word "fuzzy matching", e.g. match "mezrahi krayot" to "mezrahi bank".
	if (foundBrand == null) 
	{
		for (var i = 0; i < settings.tagsToSearchPOI.length; ++i)
		{
			var value = p.tags[settings.tagsToSearchPOI[i]];
			var brand = matchStringFuzzy(value);
			if (!matchPOI_inner(brand)) return null;
		}
		if (foundBrand != null)
		{
			printInfo(p, "name=<"+p.tags["name"] + ">, name:he=<" + p.tags["name:he"] +
			 ">, matched to [" + foundBrand.tags[settings.printTag] + "]. a fuzzy match. Not touched.");
			foundBrand = null; //comment to auto-process fuzzymatches for brands as if they're normal matches.
			// edit the comment above too.
		}
	}
	
	// We have a parent, but see if we fuzzy match a variant
	if ((foundBrand != null) && foundBrand.parentBrand === undefined)
	{
		var parentBrand = foundBrand;
		for (var i = 0; i < settings.tagsToSearchPOI.length; ++i)
		{
			var value = p.tags[settings.tagsToSearchPOI[i]];
			var brand = matchStringFuzzy(value);
			if (!matchPOI_inner(brand)) return null;
		}
		if ((foundBrand != null) && (foundBrand.parentBrand == parentBrand))
		{
			printInfo(p, "matched to [" + foundBrand.tags[settings.printTag] + "]. Fuzzy variant, most likely fine.");
			// foundBrand = null; //uncomment to prevent fuzzymatches for brands
		}
		else foundBrand = parentBrand;
	}

	// make sure the proper tags (e.g. shop,amenity) are present)
	if (foundBrand != null)
	{

		var skipUndefined = false; // True: e.g. Report a bank that has amenity="park".
		// False: e.g. Also report a bank that has NO amenity key whatsoever.
		for (var i = 0; i < settings.tagsToCheck.length; ++i)
		{
			var tag = settings.tagsToCheck[i];
			if ((foundBrand.tags[tag] !== undefined) && (p.tags[tag] !== foundBrand.tags[tag]))
			{
				if (skipUndefined && (p.tags[tag] == undefined)) continue;
				printWarning(p, " Is suspected to be " + 
				tag + "="+ foundBrand.tags[tag] +
				" but it has " + 
				tag + "=\"" + p.tags[tag] + "\". skipped");
				return null;
			}
		}
	}

	return foundBrand;
}

// apply the key:val in obj as tags to POI p
// ret: modifiedFlag
function applyBrand(p, brand)
{
	var modifiedFlag = false;
	if (brand.parentBrand != undefined) // This is a variant, first apply the parent tags.
	{
		modifiedFlag = applyParentAndVariantTags(p, brand.parentBrand, brand);
	}
	else
	{
		for (key in brand.tags)
		{
			modifiedFlag = applySingleTag(p, key, brand) || modifiedFlag;
		}
	}
	return modifiedFlag;

	function applyParentAndVariantTags(p, brand, variant)
	{
		var modifiedFlag = false;
		for (key in variant.tags)
		{
			modifiedFlag = applySingleTag(p, key, variant) || modifiedFlag;
		}
		for (key in brand.tags)
		{
			if (variant.tags[key] != undefined) continue; // Key overridden by variant
			modifiedFlag = applySingleTag(p, key, brand) || modifiedFlag;
		}

		return modifiedFlag;
	}

	function applySingleTag(p, key, brand)
	{
		var modifiedFlag = false;
		if ((key == "alt_find") || (key == "variants") || (key == "parentBrand")) return false;
		if (brand.tags[key] != "")
		{
			if (brand.tags[key] == DELETE)
			{
				if (p.tags[key] != undefined)
				{
					remove(p, key);
					modifiedFlag = true;
					printV(key + "=<DELETED>");
				}
			}
			else
			{
				if ((key == "name") || (key.indexOf("name:") != -1)) 
					return applySingleNameTag(p, key, brand); // special treatment for name tags
				if (p.tags[key] != brand.tags[key])
				{
					p.tags[key] = brand.tags[key];
					modifiedFlag = true;
					printV(key + "="+brand.tags[key]);
				}
			}
		}
		return modifiedFlag;
	}
	function applySingleNameTag(p, key, brand)
	{
		var originalVal = p.tags[key];
		var newVal = brand.tags[key];
		if (originalVal == undefined)
		{
			// no original name in this lang.
			p.tags[key] = newVal;
			return true; // modified
		}

		switch (isUseful(p, originalVal, brand))
		{
			case USEFUL:
			case FUZZY_MATCH:
			printInfo(p, key+"=<"+originalVal + "> changed to <" + 
			newVal + ">. [" + brand.tags[settings.printTag] + "] old value might be needed but usually not.");
			case NOT_USEFUL:
			if (originalVal != newVal)
			{
				p.tags[key] = newVal;
				return true; // modified
			}
			return false;
		}
	}
}

var USEFUL = 1;      // the str matches no brand, therefore useful
var NOT_USEFUL = 2;  // the str matches the brand perfectly, therefore it is not useful
var FUZZY_MATCH = 3; // Fuzzy match, may or may not be useful. Currently treated as useful (and USEFUL) is returned.
function isUseful(p, str, brand)
{
	var matchedBrand;
	matchedBrand = matchString(str);
	if (matchedBrand !== null)
	{
		if ((matchedBrand == brand) || (matchedBrand == brand.parentBrand))
			return NOT_USEFUL;
		print(str);
		printSerious(p, "THIS SHOULD NEVER HAPPEN A [" + matchedBrand.tags[settings.printTag] + "] [" + brand.tags[settings.printTag] + "]" + p.id);
		// return USEFUL;
	}
	return USEFUL; // our users currently aren't making the distinction between USEFUL and FUZZY_MATCH, 
	// so no point in computing fuzzy matches and just return "USEFUL"
	/*else
	{
		matchedBrand = matchStringFuzzy(str);
		if (matchedBrand !== null)
		{
			if ((matchedBrand == brand) || (matchedBrand == brand.parentBrand))
				return FUZZY_MATCH;
			printSerious(p, "THIS SHOULD NEVER HAPPEN B [" + matchedBrand.tags[settings.printTag] + "] [" +
			 brand.tags[settings.printTag] + "]");
			return USEFUL;
		}
		else
		{
			return USEFUL;
		}
	}*/
}

// ret modified flag
function removeOperatorIfNotUseful(p, brand)
{
	// Remove operator if it can match the brand and isn't special
	var modifiedFlag = removeIfNotUseful(p.tags["operator"], brand, "operator") || modifiedFlag;

	// remove operator:lang and it can match the brand and isn't special
	// brand:lang always removed

	for (key in p.tags)
	{
		if (key.indexOf("operator:") != -1)
		{
			modifiedFlag = removeIfNotUseful(p.tags[key], brand, key) || modifiedFlag;
		}
	}

	function removeIfNotUseful(str, brand, key)
	{
		if (str == undefined) return false;
		switch (isUseful(p, str, brand))
		{
			case USEFUL:
			case FUZZY_MATCH:
				printInfo(p, key+"=<"+p.tags[key]+"> removed. ["+ brand.tags[settings.printTag] + "]. Might be needed but usually not.");
			case NOT_USEFUL:
				remove(p, key);
				printV(key + " deleted");
				return true; 
		}
		return false;
	}

	return modifiedFlag;
}

// ret modified flag
function removeBrandLang(p)
{
	var modifiedFlag = false;
	for (key in p.tags)
	{
		if ((key.indexOf("brand:") != -1) && (key != "brand:wikipedia") && (key != "brand:wikidata"))
		{
			print("EEEEE");
			remove(p, key);
			printV(key + " deleted");
			modifiedFlag = true;
		}
	}

	return modifiedFlag;
}

function removeWkWdDuplicates(p)
{
	var modifiedFlag = false;
		if (
			(p.tags["wikipedia"] !== undefined) && 
			(p.tags["brand:wikipedia"] !== undefined) && 
			(p.tags["brand:wikipedia"] === p.tags["wikipedia"])
		)
		{
			remove(p, "wikipedia");
			modifiedFlag = true;
		}
		if (
			(p.tags["wikidata"] !== undefined) && 
			(p.tags["brand:wikidata"] !== undefined) && 
			(p.tags["brand:wikidata"] === p.tags["wikidata"])
		)
		{
			remove(p, "wikidata");
			modifiedFlag = true;
		}
		return modifiedFlag;
}

main();
print("");
print("### Script finished");
