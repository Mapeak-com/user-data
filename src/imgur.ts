import { components } from "./types.g.js";

type LinkData = components["schemas"]["LinkData"];

export async function uploadImageAndUpdateLink(url: LinkData) {
    var myHeaders = new Headers();
    myHeaders.append("Authorization", "Client-ID " + process.env.IMGUR_CLIENT_ID);

    var formdata = new FormData();
    const res = await fetch(url.url!);
    const imageBlob = await res.blob();
    formdata.append("image", imageBlob);

    var requestOptions = {
        method: 'POST',
        headers: myHeaders,
        body: formdata,
    };

    const response = await fetch("https://api.imgur.com/3/image", requestOptions);
    const result = await response.json();
    url.url = result.data.link;
}