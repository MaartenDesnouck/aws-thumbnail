var async = require("async");
var AWS = require("aws-sdk");
var gm = require("gm").subClass({
    imageMagick: true
});
var fs = require("fs");
var mktemp = require("mktemp");

var THUMB_WIDTH = 150;
var THUMB_HEIGHT = 150;
var ALLOWED_FILETYPES = ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'pdf', 'gif'];

var utils = {
    decodeKey: function(key) {
        return decodeURIComponent(key).replace(/\+/g, ' ');
    }
};

var s3 = new AWS.S3();

exports.handler = function(event, context) {
    var srcBucket = event.Records[0].s3.bucket.name;
    var srcKey = utils.decodeKey(event.Records[0].s3.object.key);
    var fileType = srcKey.match(/\.\w+$/);
    var dstBucket = srcBucket + "resized";
    var dstKey = '';

    // Sanity check: validate that source and destination are different buckets.
    if (srcBucket == dstBucket) {
        callback("Source and destination buckets are the same.");
        return;
    }

    if (fileType === null) {
        console.error("Invalid filetype found for key: " + srcKey);
        return;
    }

    fileType = fileType[0].substr(1);

    if (ALLOWED_FILETYPES.indexOf(fileType) === -1) {
        console.error("Filetype " + fileType + " not valid for thumbnail, exiting");
        return;
    }

    async.waterfall([

            function download(next) {
                //Download the image from S3
                s3.getObject({
                    Bucket: srcBucket,
                    Key: srcKey
                }, next);
            },

            function createThumbnail(response, next) {
                var temp_file, image;

                if (fileType === "pdf") {
                    temp_file = mktemp.createFileSync("/tmp/XXXXXXXXXX.pdf")
                    fs.writeFileSync(temp_file, response.Body);
                    image = gm(temp_file + "[0]");
                } else if (fileType === 'gif') {
                    temp_file = mktemp.createFileSync("/tmp/XXXXXXXXXX.gif")
                    fs.writeFileSync(temp_file, response.Body);
                    image = gm(temp_file + "[0]");
                } else {
                    image = gm(response.Body);
                }

                image.size(function(err, size) {
                    var scalingFactor = Math.min(1, THUMB_WIDTH / size.width, THUMB_HEIGHT / size.height),
                        width = scalingFactor * size.width,
                        height = scalingFactor * size.height;

                    var dstKeyExt = '-' + width + 'x' + height + '.png';
                    dstKey = srcKey.replace(/\.\w+$/, dstKeyExt);

                    this.resize(width, height)
                        .toBuffer("png", function(err, buffer) {
                            if (temp_file) {
                                fs.unlinkSync(temp_file);
                            }

                            if (err) {
                                next(err);
                            } else {
                                next(null, response.contentType, buffer);
                            }
                        });
                });
            },

            function uploadThumbnail(contentType, data, next) {
                s3.putObject({
                    Bucket: dstBucket,
                    Key: dstKey,
                    Body: data,
                    ContentType: "image/png",
                    Metadata: {
                        thumbnail: 'TRUE'
                    }
                }, next);
            }

        ],
        function(err) {
            if (err) {
                console.error(
                    "Unable to generate thumbnail for '" + srcBucket + "/" + srcKey + "'" +
                    " due to error: " + err
                );
            } else {
                console.log("Created thumbnail for '" + srcBucket + "/" + srcKey + "'");
            }

            context.done();
        });
};
